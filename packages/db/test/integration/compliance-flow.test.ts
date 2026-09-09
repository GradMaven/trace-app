import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  confirmMapping,
  createPrisma,
  loadRuleStore,
  provisionOrganization,
  runComplianceEvaluation,
  scoreDatapointTrust,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;
const VERSION = 'esrs@2026.1';

run('compliance: rule store → evaluate → confirm mapping', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const supplierA = randomUUID();
  let cat1MappingId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `xa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `xb-${userB}@test.example`, name: 'B' },
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
            slug: `x-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    await withOrgContext(
      orgA,
      async (db) => {
        await db.organization.update({
          where: { id: orgA },
          data: { reportingPeriodConfig: { activePeriod: 'FY2025' } },
        });

        const mk = async (
          metricKey: string,
          value: string,
          subjectId: string,
          subjectType: string,
        ) =>
          db.datapoint.create({
            data: {
              organizationId: orgA,
              metricKey,
              valueNumeric: value,
              unit: 'tCO2e',
              provenance: 'calculated',
              label: 'human_reviewed',
              reportingPeriod: 'FY2025',
              subjectType,
              subjectId,
              createdByUserId: userA,
            },
          });

        // Scope 1 = two additive contributions, no evidence.
        const s1a = await mk('emission_scope_1_tco2e', '820', orgA, 'organization');
        const s1b = await mk('emission_scope_1_tco2e', '483', orgA, 'organization');

        // Scope 3 cat 1 with a verified evidence record.
        const cat1 = await mk(
          'emission_cat_1_purchased_goods_services_tco2e',
          '2630',
          supplierA,
          'supplier',
        );
        const evidence = await db.evidence.create({
          data: {
            organizationId: orgA,
            type: 'supplier_report',
            title: 'Rheinstahl report 2025',
            source: 'supplier_portal',
            hash: 'z'.repeat(64),
            status: 'verified',
            reportingPeriod: 'FY2025',
            uploadedByUserId: userA,
          },
        });
        await db.datapointEvidence.create({
          data: {
            organizationId: orgA,
            datapointId: cat1.id,
            evidenceId: evidence.id,
            linkedByUserId: userA,
          },
        });

        for (const dp of [s1a, s1b, cat1]) {
          await scoreDatapointTrust(db, {
            organizationId: orgA,
            datapointId: dp.id,
            actorUserId: userA,
            requestId: 'test',
          });
        }
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('loads the ESRS rule store idempotently', async () => {
    const first = await withOrgContext(orgA, (db) => loadRuleStore(db, VERSION), prisma);
    expect(first.requiredDatapoints).toBe(9);
    const second = await withOrgContext(orgA, (db) => loadRuleStore(db, VERSION), prisma);
    expect(second.requiredDatapoints).toBe(9);

    const rdCount = await withOrgContext(
      orgA,
      (db) => db.requiredDatapoint.count({ where: { ruleStoreVersion: VERSION } }),
      prisma,
    );
    expect(rdCount).toBe(9);
  });

  it('evaluates company data against the rule store', async () => {
    const result = await withOrgContext(
      orgA,
      (db) =>
        runComplianceEvaluation(db, {
          organizationId: orgA,
          ruleStoreVersion: VERSION,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(result.mappingsWritten).toBe(9);
    expect(result.readinessPct).toBeGreaterThan(0);

    const {
      run: runRow,
      scope1,
      cat1,
      energy,
      e16,
    } = await withOrgContext(
      orgA,
      async (db) => {
        const rd = (key: string) =>
          db.requiredDatapoint.findFirst({
            where: { key, ruleStoreVersion: VERSION },
            select: { id: true },
          });
        const mapping = async (key: string) => {
          const r = await rd(key);
          return db.complianceMapping.findFirst({
            where: { organizationId: orgA, requiredDatapointId: r!.id, ruleStoreVersion: VERSION },
          });
        };
        return {
          run: await db.complianceRun.findUnique({ where: { id: result.runId } }),
          scope1: await mapping('esrs_e1_6_scope_1'),
          cat1: await mapping('esrs_e1_6_scope_3_pgs'),
          energy: await mapping('esrs_e1_5_energy_total'),
          e16: await db.disclosureStatusRecord.findFirst({
            where: { organizationId: orgA, ruleStoreVersion: VERSION },
            include: { disclosure: true },
          }),
        };
      },
      prisma,
    );

    expect(runRow?.completedAt).not.toBeNull();
    expect(scope1?.status).toBe('data_available');
    expect(scope1?.gapReasons).toContain('no_evidence');
    expect(Number(scope1?.resolvedValue)).toBe(1303); // 820 + 483 summed
    expect(cat1?.status).toBe('evidence_available');
    expect(cat1?.gapReasons).toContain('unconfirmed_mapping');
    expect(energy?.status).toBe('not_started');
    expect(energy?.gapReasons).toContain('missing_data');
    cat1MappingId = cat1!.id;
    void e16;
  });

  it('a human confirms a mapping and it reaches mapping_complete', async () => {
    const out = await withOrgContext(
      orgA,
      (db) =>
        confirmMapping(db, {
          organizationId: orgA,
          mappingId: cat1MappingId,
          confirm: true,
          note: 'Reviewed against the supplier report.',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(out.status).toBe('mapping_complete');

    const mapping = await withOrgContext(
      orgA,
      (db) => db.complianceMapping.findUnique({ where: { id: cat1MappingId } }),
      prisma,
    );
    expect(mapping?.confirmed).toBe(true);
    expect(mapping?.gapReasons).toEqual([]);
  });

  it('re-evaluation preserves the human confirmation', async () => {
    await withOrgContext(
      orgA,
      (db) =>
        runComplianceEvaluation(db, {
          organizationId: orgA,
          ruleStoreVersion: VERSION,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const mapping = await withOrgContext(
      orgA,
      (db) => db.complianceMapping.findUnique({ where: { id: cat1MappingId } }),
      prisma,
    );
    expect(mapping?.confirmed).toBe(true);
    expect(mapping?.status).toBe('mapping_complete');

    const count = await withOrgContext(
      orgA,
      (db) =>
        db.complianceMapping.count({ where: { organizationId: orgA, ruleStoreVersion: VERSION } }),
      prisma,
    );
    expect(count).toBe(9);
  });

  it('keeps a verifiable audit chain', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('isolates tenant compliance rows but shares the global rule store (RLS)', async () => {
    const counts = await withOrgContext(
      orgB,
      async (db) => ({
        mappings: await db.complianceMapping.count(),
        statuses: await db.disclosureStatusRecord.count(),
        runs: await db.complianceRun.count(),
        controls: await db.complianceControl.count(),
        regulations: await db.regulation.count({ where: { ruleStoreVersion: VERSION } }),
        requiredDatapoints: await db.requiredDatapoint.count({
          where: { ruleStoreVersion: VERSION },
        }),
      }),
      prisma,
    );
    expect(counts.mappings).toBe(0);
    expect(counts.statuses).toBe(0);
    expect(counts.runs).toBe(0);
    expect(counts.controls).toBe(0);
    expect(counts.regulations).toBeGreaterThan(0);
    expect(counts.requiredDatapoints).toBe(9);
  });
});
