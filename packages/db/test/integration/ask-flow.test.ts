import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAIProvider } from '@trace/ai';
import {
  askHistory,
  createPrisma,
  loadRuleStore,
  provisionOrganization,
  recomputeEmissions,
  runAskQuery,
  runCalculation,
  runComplianceEvaluation,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;
const VERSION = 'esrs@2026.1';
const provider = createAIProvider({
  mode: 'stub',
  extractionModel: 'claude-sonnet-5',
  classificationModel: 'claude-haiku-4-5',
});

run('ask trace: retrieval-grounded, cited answers', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `qa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `qb-${userB}@test.example`, name: 'B' },
      ],
    });
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ] as const) {
      await withOrgContext(
        org,
        (db) =>
          provisionOrganization(db, {
            organizationId: org,
            slug: `q-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    await prisma.emissionFactor.create({
      data: {
        organizationId: null,
        source: 'DEFRA',
        sourceRef: 'ng-ask',
        name: 'natural gas',
        value: '0.183',
        numeratorUnit: 'kgCO2e',
        denominatorUnit: 'kWh',
        activityDimension: 'energy',
        scope: 'scope_1',
        geography: 'DE',
        methodology: 'fuel_based',
        validFrom: new Date('2023-01-01'),
      },
    });

    await withOrgContext(
      orgA,
      async (db) => {
        await db.organization.update({
          where: { id: orgA },
          data: { reportingPeriodConfig: { activePeriod: 'FY2025' } },
        });
        for (const [period, kwh] of [
          ['FY2024', '4600000'],
          ['FY2025', '4200000'],
        ] as const) {
          const activity = await db.activityData.create({
            data: {
              organizationId: orgA,
              scope: 'scope_1',
              category: 'Natural gas',
              value: kwh,
              unit: 'kWh',
              reportingPeriod: period,
              provenance: 'measured',
              subjectType: 'organization',
              subjectId: orgA,
              occurredOn: new Date(`${period.slice(2)}-12-31`),
              createdByUserId: userA,
            },
          });
          await runCalculation(db, {
            organizationId: orgA,
            activityId: activity.id,
            actorUserId: userA,
            requestId: 'test',
          });
          await recomputeEmissions(db, {
            organizationId: orgA,
            reportingPeriod: period,
            actorUserId: userA,
            requestId: 'test',
          });
        }
        // A datapoint with no evidence.
        await db.datapoint.create({
          data: {
            organizationId: orgA,
            metricKey: 'energy_consumption_total_mwh',
            valueNumeric: '2050000',
            unit: 'MWh',
            provenance: 'estimated',
            label: 'human_reviewed',
            reportingPeriod: 'FY2025',
            subjectType: 'organization',
            subjectId: orgA,
            createdByUserId: userA,
          },
        });
        await loadRuleStore(db, VERSION);
        await runComplianceEvaluation(db, {
          organizationId: orgA,
          ruleStoreVersion: VERSION,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        });
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const ask = (question: string) =>
    withOrgContext(
      orgA,
      (db) =>
        runAskQuery(
          db,
          { provider },
          { organizationId: orgA, question, actorUserId: userA, requestId: 'test' },
        ),
      prisma,
    );

  it('answers an emissions question from retrieved records, with citations', async () => {
    const res = await ask('What were our Scope 1, 2 and 3 emissions in FY2025?');
    expect(res.intent).toBe('emissions_summary');
    expect(res.answered).toBe(true);
    expect(res.recordCount).toBe(6);
    expect(res.citations.length).toBeGreaterThan(0);
    for (const c of res.citations) {
      expect(c.href!.startsWith('/')).toBe(true);
      expect(c.title.length).toBeGreaterThan(0);
    }
    expect(res.provider).toBe('stub');

    const jobs = await withOrgContext(
      orgA,
      (db) => db.aiJob.findMany({ where: { id: { in: res.aiJobIds } } }),
      prisma,
    );
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.capability === 'nl_analytics' && j.status === 'completed')).toBe(
      true,
    );

    const row = await withOrgContext(
      orgA,
      (db) => db.askQuery.findUnique({ where: { id: res.id } }),
      prisma,
    );
    expect(row?.answer).toBe(res.answer);
    expect(row?.answered).toBe(true);
  });

  it('handles a trend question across periods', async () => {
    const res = await ask('How did total emissions change between FY2024 and FY2025?');
    expect(res.intent).toBe('emissions_trend');
    expect(res.recordCount).toBe(2);
    expect(res.answered).toBe(true);
  });

  it('surfaces datapoints with no evidence', async () => {
    const res = await ask('Which datapoints are missing supporting evidence?');
    expect(res.intent).toBe('missing_evidence');
    expect(res.recordCount).toBeGreaterThanOrEqual(1);
    expect(res.citations.some((c) => c.href!.startsWith('/data/datapoints/'))).toBe(true);
  });

  it('refuses questions it cannot answer from the tenant data (one model call only)', async () => {
    const res = await ask('What is the capital of France?');
    expect(res.intent).toBe('unsupported');
    expect(res.answered).toBe(false);
    expect(res.recordCount).toBe(0);
    expect(res.aiJobIds).toHaveLength(1);
    expect(res.answer.toLowerCase()).toContain("can't answer");
  });

  it('says "no data" for a supported intent with nothing to retrieve', async () => {
    const res = await ask('Which suppliers contribute the most emissions?');
    expect(res.intent).toBe('top_suppliers_by_emissions');
    expect(res.answered).toBe(false);
    expect(res.recordCount).toBe(0);
    expect(res.aiJobIds).toHaveLength(1);
  });

  it('records history newest-first', async () => {
    const hist = await withOrgContext(orgA, (db) => askHistory(db, orgA, 10), prisma);
    expect(hist.length).toBeGreaterThanOrEqual(5);
    const times = hist.map((h) => new Date(h.createdAt as string).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('is tenant-isolated (RLS)', async () => {
    const count = await withOrgContext(orgB, (db) => db.askQuery.count(), prisma);
    expect(count).toBe(0);
    const hist = await withOrgContext(orgB, (db) => askHistory(db, orgB, 10), prisma);
    expect(hist).toEqual([]);
  });
});
