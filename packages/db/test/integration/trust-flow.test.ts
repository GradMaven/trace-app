import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrisma,
  provisionOrganization,
  runQualityScan,
  scoreDatapointTrust,
  updateAnomalyStatus,
  updateIssueStatus,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('trust engine: scoring → data-quality scan → issue triage', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const supplierA = randomUUID();
  const supplierB = randomUUID();

  let weakDpId = '';
  let strongDpId = '';
  let pctDpId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `ta-${userA}@test.example`, name: 'A' },
        { id: userB, email: `tb-${userB}@test.example`, name: 'B' },
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
            slug: `t-${org.slice(0, 8)}`,
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

        // Weak: estimated, AI-extracted, no evidence.
        const weak = await db.datapoint.create({
          data: {
            organizationId: orgA,
            metricKey: 'scope1_tco2e',
            valueNumeric: '1000',
            unit: 'tCO2e',
            provenance: 'estimated',
            label: 'ai_extracted',
            reportingPeriod: 'FY2025',
            subjectType: 'supplier',
            subjectId: supplierA,
            createdByUserId: userA,
          },
        });
        weakDpId = weak.id;

        // Strong: measured, verified, with a verified evidence record linked.
        const evidence = await db.evidence.create({
          data: {
            organizationId: orgA,
            type: 'utility_bill',
            title: 'Grid electricity invoice FY2025',
            source: 'manual',
            hash: 'x'.repeat(64),
            status: 'verified',
            uploadedByUserId: userA,
          },
        });
        const strong = await db.datapoint.create({
          data: {
            organizationId: orgA,
            metricKey: 'emission_scope_1_tco2e',
            valueNumeric: '500',
            unit: 'tCO2e',
            provenance: 'measured',
            label: 'verified',
            reportingPeriod: 'FY2025',
            subjectType: 'organization',
            subjectId: orgA,
            createdByUserId: userA,
          },
        });
        strongDpId = strong.id;
        await db.datapointEvidence.create({
          data: {
            organizationId: orgA,
            datapointId: strong.id,
            evidenceId: evidence.id,
            linkedByUserId: userA,
          },
        });

        // Impossible: a percentage over 100.
        const pct = await db.datapoint.create({
          data: {
            organizationId: orgA,
            metricKey: 'renewable_electricity_pct',
            valueNumeric: '140',
            provenance: 'supplier_reported',
            label: 'human_reviewed',
            reportingPeriod: 'FY2025',
            subjectType: 'supplier',
            subjectId: supplierA,
            createdByUserId: userA,
          },
        });
        pctDpId = pct.id;

        // A time series for one (supplier, metric) with a spike in FY2025.
        for (const [period, value] of [
          ['FY2022', '100'],
          ['FY2023', '102'],
          ['FY2024', '98'],
          ['FY2025', '260'],
        ] as const) {
          await db.datapoint.create({
            data: {
              organizationId: orgA,
              metricKey: 'energy_consumption_mwh',
              valueNumeric: value,
              unit: 'MWh',
              provenance: 'supplier_reported',
              label: 'human_reviewed',
              reportingPeriod: period,
              subjectType: 'supplier',
              subjectId: supplierB,
              createdByUserId: userA,
            },
          });
        }
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('scores an individual datapoint with a full additive breakdown', async () => {
    const outcome = await withOrgContext(
      orgA,
      (db) =>
        scoreDatapointTrust(db, {
          organizationId: orgA,
          datapointId: strongDpId,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(outcome.value).toBeGreaterThan(80);
    expect(outcome.band).toBe('high');

    const row = await withOrgContext(
      orgA,
      (db) => db.trustScore.findFirst({ where: { datapointId: strongDpId } }),
      prisma,
    );
    expect(Array.isArray(row?.breakdown)).toBe(true);
    expect((row?.breakdown as unknown[]).length).toBe(7);
  });

  it('re-scoring with no change does not append a new row', async () => {
    const again = await withOrgContext(
      orgA,
      (db) =>
        scoreDatapointTrust(db, {
          organizationId: orgA,
          datapointId: strongDpId,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(again.unchanged).toBe(true);
    const count = await withOrgContext(
      orgA,
      (db) => db.trustScore.count({ where: { datapointId: strongDpId } }),
      prisma,
    );
    expect(count).toBe(1);
  });

  it('runs a data-quality scan: scores in-period datapoints and opens issues', async () => {
    const result = await withOrgContext(
      orgA,
      (db) =>
        runQualityScan(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(result.datapointsScored).toBe(4); // weak, strong, pct, series-FY2025
    expect(result.avgTrustScore).not.toBeNull();
    expect(result.issuesOpen).toBeGreaterThan(0);

    const { scan, weak, strong, missingEvidence, impossible } = await withOrgContext(
      orgA,
      async (db) => ({
        scan: await db.qualityScan.findUnique({ where: { id: result.scanId } }),
        weak: await db.trustScore.findFirst({
          where: { datapointId: weakDpId, supersededBy: { none: {} } },
        }),
        strong: await db.trustScore.findFirst({
          where: { datapointId: strongDpId, supersededBy: { none: {} } },
        }),
        missingEvidence: await db.dataQualityIssue.count({
          where: { kind: 'missing_evidence', status: 'open' },
        }),
        impossible: await db.dataQualityIssue.findFirst({
          where: { kind: 'impossible_value', datapointId: pctDpId },
        }),
      }),
      prisma,
    );
    expect(scan?.completedAt).not.toBeNull();
    expect(strong!.value).toBeGreaterThan(weak!.value);
    expect(missingEvidence).toBeGreaterThanOrEqual(2);
    expect(impossible?.severity).toBe('critical');
  });

  it('flags the FY2025 spike as an anomaly', async () => {
    const anomalies = await withOrgContext(
      orgA,
      (db) => db.anomaly.findMany({ where: { metricKey: 'energy_consumption_mwh' } }),
      prisma,
    );
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    expect(anomalies.some((a) => a.pointKey === 'FY2025')).toBe(true);
    expect(anomalies.every((a) => Array.isArray(a.explanations) && a.explanations.length > 0)).toBe(
      true,
    );
  });

  it('re-scanning is idempotent — no duplicate issues, lastSeenAt advances', async () => {
    const before = await withOrgContext(
      orgA,
      (db) => db.dataQualityIssue.findMany({ orderBy: { id: 'asc' } }),
      prisma,
    );
    await new Promise((r) => setTimeout(r, 5));
    await withOrgContext(
      orgA,
      (db) =>
        runQualityScan(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const after = await withOrgContext(
      orgA,
      (db) => db.dataQualityIssue.findMany({ orderBy: { id: 'asc' } }),
      prisma,
    );
    expect(after.length).toBe(before.length);
    const b = before.find((i) => i.kind === 'impossible_value')!;
    const a = after.find((i) => i.id === b.id)!;
    expect(a.lastSeenAt.getTime()).toBeGreaterThan(b.lastSeenAt.getTime());
  });

  it('auto-resolves an issue once the underlying problem is fixed', async () => {
    await withOrgContext(
      orgA,
      (db) => db.datapoint.update({ where: { id: pctDpId }, data: { valueNumeric: '40' } }),
      prisma,
    );
    await withOrgContext(
      orgA,
      (db) =>
        runQualityScan(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const issue = await withOrgContext(
      orgA,
      (db) =>
        db.dataQualityIssue.findFirst({
          where: { kind: 'impossible_value', datapointId: pctDpId },
        }),
      prisma,
    );
    expect(issue?.status).toBe('resolved');
    expect(issue?.resolutionNote).toMatch(/no longer detected/i);
  });

  it('lets a reviewer dismiss an issue and reopen an anomaly', async () => {
    const issue = await withOrgContext(
      orgA,
      (db) =>
        db.dataQualityIssue.findFirst({ where: { kind: 'missing_evidence', status: 'open' } }),
      prisma,
    );
    const dismissed = await withOrgContext(
      orgA,
      (db) =>
        updateIssueStatus(db, {
          organizationId: orgA,
          issueId: issue!.id,
          status: 'dismissed',
          note: 'Measured meter — evidence not applicable.',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(dismissed.status).toBe('dismissed');

    const anomaly = await withOrgContext(
      orgA,
      (db) => db.anomaly.findFirst({ where: { metricKey: 'energy_consumption_mwh' } }),
      prisma,
    );
    const explained = await withOrgContext(
      orgA,
      (db) =>
        updateAnomalyStatus(db, {
          organizationId: orgA,
          anomalyId: anomaly!.id,
          status: 'explained',
          note: 'New production line commissioned in 2025.',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(explained.status).toBe('explained');
  });

  it('keeps a verifiable audit chain', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('does not leak trust data across tenants (RLS)', async () => {
    const counts = await withOrgContext(
      orgB,
      async (db) => ({
        scores: await db.trustScore.count(),
        issues: await db.dataQualityIssue.count(),
        anomalies: await db.anomaly.count(),
        scans: await db.qualityScan.count(),
      }),
      prisma,
    );
    expect(counts).toEqual({ scores: 0, issues: 0, anomalies: 0, scans: 0 });
  });
});
