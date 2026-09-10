import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrisma,
  generateRegulatoryFiling,
  listRegulatoryFilings,
  loadRuleStore,
  provisionOrganization,
  regulatoryFilingById,
  runComplianceEvaluation,
  scoreDatapointTrust,
  withOrgContext,
  type FilingDeps,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;
const VERSION = 'esrs@2026.1';

/** In-memory `putBytes` so the flow test never touches a real object store. */
function memoryDeps(): FilingDeps & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    store,
    driver: 'memory',
    putBytes: async (key, bytes) => {
      store.set(key, bytes);
    },
  };
}

run('regulatory filing: assemble → version → "do not file" guard', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const supplierA = randomUUID();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `fa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `fb-${userB}@test.example`, name: 'B' },
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
            slug: `f-${org.slice(0, 8)}`,
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
        await loadRuleStore(db, VERSION);

        const mk = (metricKey: string, value: string, subjectId: string, subjectType: string) =>
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

        const s1 = await mk('emission_scope_1_tco2e', '1303', orgA, 'organization');
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
            title: 'Supplier report 2025',
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
        for (const dp of [s1, cat1]) {
          await scoreDatapointTrust(db, {
            organizationId: orgA,
            datapointId: dp.id,
            actorUserId: userA,
            requestId: 'test',
          });
        }

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

  it('assembles a filing that is blocked while required datapoints are unresolved', async () => {
    const deps = memoryDeps();
    const filing = await withOrgContext(
      orgA,
      (db) =>
        generateRegulatoryFiling(db, deps, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          ruleStoreVersion: VERSION,
          generatedByUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );

    expect(filing.version).toBe(1);
    expect(filing.readiness).toBe('blocked');
    expect(filing.gapCount).toBeGreaterThan(0);
    expect(filing.filing.blockers.length).toBeGreaterThan(0);
    expect(filing.filing.stats.requiredDatapoints).toBe(9);
    // JSON + tagged HTML were both content-addressed under the digest.
    expect(deps.store.has(filing.storageKey)).toBe(true);
    expect(deps.store.has(filing.htmlStorageKey)).toBe(true);
    const html = deps.store.get(filing.htmlStorageKey)!.toString('utf8');
    expect(html).toContain('data-esrs-filing');
    expect(html).toContain('does not assert conformity');
    expect(html).not.toMatch(/\bis compliant\b/i);
  });

  it('each generate makes an immutable new version with its own digest', async () => {
    const deps = memoryDeps();
    const v2 = await withOrgContext(
      orgA,
      (db) =>
        generateRegulatoryFiling(db, deps, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          ruleStoreVersion: VERSION,
          generatedByUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(v2.version).toBe(2);

    const rows = await withOrgContext(orgA, (db) => listRegulatoryFilings(db, orgA), prisma);
    expect(rows.length).toBe(2);
    const fetched = await withOrgContext(
      orgA,
      (db) => regulatoryFilingById(db, orgA, v2.id),
      prisma,
    );
    expect(fetched.sha256).toBe(v2.sha256);
  });

  it('writes a filing.generated audit-log entry', async () => {
    const count = await withOrgContext(
      orgA,
      (db) =>
        db.auditLog.count({ where: { organizationId: orgA, action: 'filing.generated' } }),
      prisma,
    );
    expect(count).toBe(2);
  });

  it('isolates filings by tenant (RLS FORCE)', async () => {
    const rows = await withOrgContext(orgB, (db) => listRegulatoryFilings(db, orgB), prisma);
    expect(rows.length).toBe(0);
    await expect(
      withOrgContext(orgB, (db) => db.regulatoryFiling.count(), prisma),
    ).resolves.toBe(0);
  });

  it('refuses to assemble when the requested rule store is not loaded', async () => {
    const deps = memoryDeps();
    await expect(
      withOrgContext(
        orgA,
        (db) =>
          generateRegulatoryFiling(db, deps, {
            organizationId: orgA,
            reportingPeriod: 'FY2025',
            ruleStoreVersion: 'esrs@2099.1',
            generatedByUserId: userA,
            requestId: 'test',
          }),
        prisma,
      ),
    ).rejects.toThrow(/rule_store_not_loaded/);
  });
});
