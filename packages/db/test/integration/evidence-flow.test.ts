import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrisma,
  provisionOrganization,
  supersedeEvidence,
  transitionEvidence,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('evidence lifecycle + datapoint linking', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let evidenceId = '';
  let datapointId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `ea-${userA}@test.example`, name: 'A' },
        { id: userB, email: `eb-${userB}@test.example`, name: 'B' },
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
            slug: `e-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    ({ evidenceId, datapointId } = await withOrgContext(
      orgA,
      async (db) => {
        const doc = await db.document.create({
          data: {
            organizationId: orgA,
            filename: 'report.pdf',
            mime: 'application/pdf',
            sizeBytes: 1234,
            checksumSha256: 'a'.repeat(64),
            storageKey: `docs/${orgA}/${'a'.repeat(64)}/report.pdf`,
            storageDriver: 'local',
            uploadedByUserId: userA,
          },
        });
        const ev = await db.evidence.create({
          data: {
            organizationId: orgA,
            type: 'supplier_report',
            title: 'Report',
            documentId: doc.id,
            source: 'upload',
            reportingPeriod: 'FY2025',
            hash: 'h',
            status: 'uploaded',
            uploadedByUserId: userA,
          },
        });
        const dp = await db.datapoint.create({
          data: {
            organizationId: orgA,
            metricKey: 'scope1_tco2e',
            valueNumeric: 1283,
            unit: 'tCO2e',
            provenance: 'supplier_reported',
            subjectType: 'supplier',
            subjectId: randomUUID(),
            createdByUserId: userA,
          },
        });
        await db.datapointEvidence.create({
          data: { organizationId: orgA, datapointId: dp.id, evidenceId: ev.id, linkedByUserId: userA },
        });
        return { evidenceId: ev.id, datapointId: dp.id };
      },
      prisma,
    ));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('advances uploaded → reviewed with evidence.update', async () => {
    const r = await withOrgContext(
      orgA,
      (db) =>
        transitionEvidence(db, {
          organizationId: orgA,
          evidenceId,
          to: 'reviewed',
          actorUserId: userA,
          permissions: ['evidence.update'],
          requestId: 'test',
        }),
      prisma,
    );
    expect(r.status).toBe('reviewed');
  });

  it('refuses reviewed → verified without evidence.verify', async () => {
    await expect(
      withOrgContext(
        orgA,
        (db) =>
          transitionEvidence(db, {
            organizationId: orgA,
            evidenceId,
            to: 'verified',
            actorUserId: userA,
            permissions: ['evidence.update'],
            requestId: 'test',
          }),
        prisma,
      ),
    ).rejects.toThrow();
  });

  it('verifies with evidence.verify and records a verification row', async () => {
    await withOrgContext(
      orgA,
      (db) =>
        transitionEvidence(db, {
          organizationId: orgA,
          evidenceId,
          to: 'verified',
          actorUserId: userA,
          permissions: ['evidence.verify'],
          method: 'document_review',
          requestId: 'test',
        }),
      prisma,
    );
    const verifs = await withOrgContext(
      orgA,
      (db) => db.evidenceVerification.findMany({ where: { evidenceId } }),
      prisma,
    );
    expect(verifs).toHaveLength(1);
    expect(verifs[0]!.outcome).toBe('verified');
  });

  it('supersede creates v2 and marks v1 superseded', async () => {
    const next = await withOrgContext(
      orgA,
      (db) =>
        supersedeEvidence(db, {
          organizationId: orgA,
          evidenceId,
          actorUserId: userA,
          requestId: 'test',
          overrides: { title: 'Report (revised)' },
        }),
      prisma,
    );
    expect(next.version).toBe(2);
    const old = await withOrgContext(
      orgA,
      (db) => db.evidence.findUnique({ where: { id: evidenceId } }),
      prisma,
    );
    expect(old?.status).toBe('superseded');
  });

  it('keeps a verifiable audit chain', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('does not leak evidence / datapoints across tenants (RLS)', async () => {
    const counts = await withOrgContext(
      orgB,
      async (db) => ({
        documents: await db.document.count(),
        evidence: await db.evidence.count(),
        datapoints: await db.datapoint.count(),
        links: await db.datapointEvidence.count(),
      }),
      prisma,
    );
    expect(counts).toEqual({ documents: 0, evidence: 0, datapoints: 0, links: 0 });
    expect(datapointId).not.toEqual('');
  });
});
