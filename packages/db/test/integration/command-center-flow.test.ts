import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  commandCenterOverview,
  createPrisma,
  loadRuleStore,
  provisionOrganization,
  recomputeEmissions,
  runAuditSimulation,
  runCalculation,
  runComplianceEvaluation,
  runQualityScan,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;
const VERSION = 'esrs@2026.1';

run('command center: executive overview composed from real model data', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `ca-${userA}@test.example`, name: 'A' },
        { id: userB, email: `cb-${userB}@test.example`, name: 'B' },
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
            slug: `cc-${org.slice(0, 8)}`,
            legalName: org === orgA ? 'Alpha Manufacturing AG' : 'Beta GmbH',
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
        sourceRef: 'ng-cc',
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

        // A supplier-reported datapoint so the provenance mix isn't all calculated.
        await db.datapoint.create({
          data: {
            organizationId: orgA,
            metricKey: 'renewable_electricity_pct',
            valueNumeric: '52',
            unit: '%',
            provenance: 'supplier_reported',
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
        await runQualityScan(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        });
        await runAuditSimulation(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          ruleStoreVersion: VERSION,
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

  it('composes emissions, trend, provenance, trust, audit and compliance', async () => {
    const o = await withOrgContext(orgA, (db) => commandCenterOverview(db, orgA), prisma);

    expect(o.organization.legalName).toBe('Alpha Manufacturing AG');
    expect(o.reportingPeriod).toBe('FY2025');

    expect(Number(o.emissions.total)).toBeGreaterThan(0);
    expect(o.emissionsTrend.map((t) => t.reportingPeriod)).toEqual(['FY2024', 'FY2025']);
    expect(Number(o.emissionsTrend[0]!.total)).toBeGreaterThan(Number(o.emissionsTrend[1]!.total));

    expect(o.provenance.total).toBeGreaterThan(0);
    expect(o.provenance.byProvenance.some((p) => p.provenance === 'supplier_reported')).toBe(true);
    expect(o.provenance.primarySharePct).toBeGreaterThan(0);

    expect(o.trust.scored).toBeGreaterThan(0);
    expect(o.audit.readinessValue).toBeGreaterThanOrEqual(0);
    expect(o.audit.readinessValue).toBeLessThanOrEqual(100);

    expect(o.compliance.ruleStoreLoaded).toBe(true);
    expect(o.compliance.disclosures.total).toBe(4);
    expect(o.compliance.readinessPct).toBeGreaterThan(0);

    expect(o.recentActivity.length).toBeGreaterThan(0);
  });

  it('is tenant-isolated — a second org sees only the global rule store', async () => {
    const o = await withOrgContext(orgB, (db) => commandCenterOverview(db, orgB), prisma);
    expect(Number(o.emissions.total)).toBe(0);
    expect(o.emissionsTrend).toEqual([]);
    expect(o.provenance.total).toBe(0);
    expect(o.trust.scored).toBe(0);
    expect(o.audit.readinessValue).toBeNull();
    expect(o.compliance.disclosures.total).toBe(0);
    expect(o.compliance.ruleStoreLoaded).toBe(true); // global, not RLS'd
    expect(o.suppliers.active).toBe(0);
  });
});
