import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAudit,
  createFinding,
  createPrisma,
  generateAuditPackage,
  loadRuleStore,
  provisionOrganization,
  runAuditSimulation,
  runCalculation,
  runComplianceEvaluation,
  runQualityScan,
  updateFinding,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;
const VERSION = 'esrs@2026.1';

run('audit workspace: simulate → findings → package', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let calcId = '';
  let unapprovedFindingId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `aa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `ab-${userB}@test.example`, name: 'B' },
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
            slug: `au-${org.slice(0, 8)}`,
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
        sourceRef: 'ng-2025',
        name: 'natural gas',
        value: '0.183',
        numeratorUnit: 'kgCO2e',
        denominatorUnit: 'kWh',
        activityDimension: 'energy',
        scope: 'scope_1',
        geography: 'DE',
        methodology: 'fuel_based',
        validFrom: new Date('2024-01-01'),
      },
    });

    await withOrgContext(
      orgA,
      async (db) => {
        await db.organization.update({
          where: { id: orgA },
          data: { reportingPeriodConfig: { activePeriod: 'FY2025' } },
        });

        // A verified evidence + a datapoint that leans on it.
        const ev = await db.evidence.create({
          data: {
            organizationId: orgA,
            type: 'utility_bill',
            title: 'Gas invoice FY2025',
            source: 'manual',
            hash: 'v'.repeat(64),
            status: 'verified',
            uploadedByUserId: userA,
          },
        });
        const strong = await db.datapoint.create({
          data: {
            organizationId: orgA,
            metricKey: 'renewable_electricity_pct',
            valueNumeric: '55',
            unit: '%',
            provenance: 'measured',
            label: 'verified',
            reportingPeriod: 'FY2025',
            subjectType: 'organization',
            subjectId: orgA,
            createdByUserId: userA,
          },
        });
        await db.datapointEvidence.create({
          data: {
            organizationId: orgA,
            datapointId: strong.id,
            evidenceId: ev.id,
            linkedByUserId: userA,
          },
        });

        // A datapoint with no evidence at all.
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

        // An activity → calculation → (unapproved) calculated datapoint.
        const activity = await db.activityData.create({
          data: {
            organizationId: orgA,
            scope: 'scope_1',
            category: 'Natural gas',
            value: '4200000',
            unit: 'kWh',
            reportingPeriod: 'FY2025',
            provenance: 'measured',
            subjectType: 'organization',
            subjectId: orgA,
            occurredOn: new Date('2025-12-31'),
            createdByUserId: userA,
          },
        });
        const calc = await runCalculation(db, {
          organizationId: orgA,
          activityId: activity.id,
          actorUserId: userA,
          requestId: 'test',
        });
        calcId = calc.calculationId;

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
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('runs a readiness simulation with a 7-dimension breakdown and opens findings', async () => {
    const result = await withOrgContext(
      orgA,
      (db) =>
        runAuditSimulation(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          ruleStoreVersion: VERSION,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(result.readiness.value).toBeGreaterThanOrEqual(0);
    expect(result.readiness.value).toBeLessThanOrEqual(100);
    expect(result.readiness.breakdown).toHaveLength(7);
    expect(result.findingsOpen).toBeGreaterThan(0);

    const { runRow, unapproved, noEvidence, gaps } = await withOrgContext(
      orgA,
      async (db) => ({
        runRow: await db.auditSimulationRun.findFirst({ where: { id: result.runId } }),
        unapproved: await db.auditFinding.findFirst({
          where: { organizationId: orgA, kind: 'unapproved_calculation', subjectId: calcId },
        }),
        noEvidence: await db.auditFinding.findFirst({
          where: { organizationId: orgA, kind: 'datapoint_without_lineage' },
        }),
        gaps: await db.auditFinding.count({
          where: {
            organizationId: orgA,
            kind: { in: ['compliance_gap', 'compliance_review_required'] },
          },
        }),
      }),
      prisma,
    );
    expect(runRow?.completedAt).not.toBeNull();
    expect(unapproved?.severity).toBe('warning');
    expect(noEvidence).not.toBeNull();
    expect(gaps).toBeGreaterThan(0);
    unapprovedFindingId = unapproved!.id;
  });

  it('re-running is idempotent — no duplicate findings, lastSeenAt advances', async () => {
    const before = await withOrgContext(
      orgA,
      (db) => db.auditFinding.findMany({ where: { organizationId: orgA }, orderBy: { id: 'asc' } }),
      prisma,
    );
    await new Promise((r) => setTimeout(r, 5));
    await withOrgContext(
      orgA,
      (db) =>
        runAuditSimulation(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          ruleStoreVersion: VERSION,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const after = await withOrgContext(
      orgA,
      (db) => db.auditFinding.findMany({ where: { organizationId: orgA }, orderBy: { id: 'asc' } }),
      prisma,
    );
    expect(after.length).toBe(before.length);
    const b = before.find((f) => f.id === unapprovedFindingId)!;
    const a = after.find((f) => f.id === unapprovedFindingId)!;
    expect(a.lastSeenAt.getTime()).toBeGreaterThan(b.lastSeenAt.getTime());
  });

  it('auto-resolves the unapproved-calculation finding once the calculation is approved', async () => {
    await withOrgContext(
      orgA,
      (db) =>
        db.calculation.update({
          where: { id: calcId },
          data: { approvedByUserId: userA, approvedAt: new Date() },
        }),
      prisma,
    );
    await withOrgContext(
      orgA,
      (db) =>
        runAuditSimulation(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          ruleStoreVersion: VERSION,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const f = await withOrgContext(
      orgA,
      (db) => db.auditFinding.findUnique({ where: { id: unapprovedFindingId } }),
      prisma,
    );
    expect(f?.status).toBe('resolved');
    expect(f?.resolutionNote).toMatch(/no longer detected/i);
  });

  it('accepted_risk is sticky across a re-run', async () => {
    const noEvidence = await withOrgContext(
      orgA,
      (db) =>
        db.auditFinding.findFirst({
          where: { organizationId: orgA, kind: 'datapoint_without_lineage' },
        }),
      prisma,
    );
    await withOrgContext(
      orgA,
      (db) =>
        updateFinding(db, {
          organizationId: orgA,
          findingId: noEvidence!.id,
          status: 'accepted_risk',
          note: 'Energy total is a preliminary estimate; evidence to follow in Q1.',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    await withOrgContext(
      orgA,
      (db) =>
        runAuditSimulation(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          ruleStoreVersion: VERSION,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const f = await withOrgContext(
      orgA,
      (db) => db.auditFinding.findUnique({ where: { id: noEvidence!.id } }),
      prisma,
    );
    expect(f?.status).toBe('accepted_risk');
  });

  it('supports a manual finding and an audit engagement', async () => {
    const manual = await withOrgContext(
      orgA,
      (db) =>
        createFinding(db, {
          organizationId: orgA,
          severity: 'info',
          subjectType: 'organization',
          subjectId: 'organization',
          title: 'Documented boundary needs a version bump',
          detail: 'The inventory boundary memo predates the FY2025 acquisitions.',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const row = await withOrgContext(
      orgA,
      (db) => db.auditFinding.findUnique({ where: { id: manual.id } }),
      prisma,
    );
    expect(row?.source).toBe('manual');

    const audit = await withOrgContext(
      orgA,
      (db) =>
        createAudit(db, {
          organizationId: orgA,
          name: 'FY2025 dry run',
          reportingPeriod: 'FY2025',
          externalAuditor: 'Prüfwerk GmbH',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const auditRow = await withOrgContext(
      orgA,
      (db) => db.audit.findUnique({ where: { id: audit.id } }),
      prisma,
    );
    expect(auditRow?.externalAuditor).toBe('Prüfwerk GmbH');
  });

  it('generates an audit package: content-addressed JSON with every section', async () => {
    const captured: Record<string, Buffer> = {};
    const result = await withOrgContext(
      orgA,
      (db) =>
        generateAuditPackage(
          db,
          {
            driver: 'local',
            putBytes: async (key, bytes) => {
              captured[key] = bytes;
            },
          },
          {
            organizationId: orgA,
            reportingPeriod: 'FY2025',
            ruleStoreVersion: VERSION,
            actorUserId: userA,
            requestId: 'test',
          },
        ),
      prisma,
    );
    expect(result.status).toBe('ready');
    expect(result.storageKey).toBe(`audit-packages/${orgA}/${result.contentDigest}/package.json`);
    expect(captured[result.storageKey!]).toBeInstanceOf(Buffer);

    const bundle = JSON.parse(captured[result.storageKey!]!.toString('utf8'));
    for (const s of [
      'meta',
      'organization',
      'inventory',
      'evidence',
      'calculations',
      'datapoints',
      'compliance',
      'findings',
      'auditTrail',
    ]) {
      expect(bundle).toHaveProperty(s);
    }
    expect(bundle.auditTrail.intact).toBe(true);
    expect(bundle.calculations.length).toBeGreaterThan(0);
    expect(bundle.calculations[0].reproduce.reproduced).toBe(true);

    const pkgRow = await withOrgContext(
      orgA,
      (db) => db.auditPackage.findUnique({ where: { id: result.packageId } }),
      prisma,
    );
    expect(pkgRow?.checksumSha256).toBe(result.contentDigest);
    expect(pkgRow?.status).toBe('ready');
  });

  it('keeps a verifiable audit chain', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('does not leak audit-workspace data across tenants (RLS)', async () => {
    const counts = await withOrgContext(
      orgB,
      async (db) => ({
        audits: await db.audit.count(),
        findings: await db.auditFinding.count(),
        sims: await db.auditSimulationRun.count(),
        packages: await db.auditPackage.count(),
      }),
      prisma,
    );
    expect(counts).toEqual({ audits: 0, findings: 0, sims: 0, packages: 0 });
  });
});
