import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAIProvider } from '@trace/ai';
import {
  createPrisma,
  promoteCandidate,
  provisionOrganization,
  rejectCandidate,
  runExtractionPipeline,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

const REPORT = `ACME Steel GmbH — Sustainability Report 2025
Prepared by ACME Steel GmbH. Reporting year: 2025.
Our Scope 1 emissions were 1,303 tCO2e.
Scope 2 (market-based) emissions were 3,100 tCO2e.
Renewable electricity share reached 48%.
All sites are ISO 14001 certified.
We have a science-based target to halve emissions by 2030.
`;

const provider = createAIProvider({
  mode: 'stub',
  extractionModel: 'claude-sonnet-5',
  classificationModel: 'claude-haiku-4-5',
});

run('AI extraction pipeline (stub provider)', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let documentId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `aia-${userA}@test.example`, name: 'A' },
        { id: userB, email: `aib-${userB}@test.example`, name: 'B' },
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
            slug: `ai-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    documentId = await withOrgContext(
      orgA,
      async (db) => {
        const doc = await db.document.create({
          data: {
            organizationId: orgA,
            filename: 'report.txt',
            mime: 'text/plain',
            sizeBytes: REPORT.length,
            checksumSha256: 'b'.repeat(64),
            storageKey: `docs/${orgA}/${'b'.repeat(64)}/report.txt`,
            storageDriver: 'local',
            uploadedByUserId: userA,
          },
        });
        return doc.id;
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('parses, classifies, extracts, and records two AIJobs', async () => {
    const result = await withOrgContext(
      orgA,
      (db) =>
        runExtractionPipeline(
          db,
          { provider, fetchBytes: async () => Buffer.from(REPORT) },
          { organizationId: orgA, documentId, actorUserId: userA, requestId: 'test' },
        ),
      prisma,
    );
    expect(result.status).toBe('ready_for_review');
    expect(result.candidateCount).toBeGreaterThanOrEqual(4);
    expect(result.aiJobIds).toHaveLength(2);

    const jobs = await withOrgContext(orgA, (db) => db.aiJob.findMany(), prisma);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.provider === 'stub' && j.model === 'stub-heuristic@1')).toBe(true);
    expect(jobs.every((j) => j.status === 'completed')).toBe(true);
  });

  it('creates pending candidates with source spans', async () => {
    const candidates = await withOrgContext(
      orgA,
      (db) => db.candidateDatapoint.findMany({ where: { documentId } }),
      prisma,
    );
    const scope1 = candidates.find((c) => c.metricKey === 'scope1_tco2e')!;
    expect(scope1.status).toBe('pending');
    expect(scope1.valueNumeric?.toString()).toBe('1303');
    const spans = scope1.sourceSpans as Array<{ sourceText: string; charStart: number | null }>;
    expect(spans[0]!.charStart).not.toBeNull();
    expect(REPORT).toContain(spans[0]!.sourceText);
  });

  it('promotes a candidate to a datapoint backed by evidence from the document', async () => {
    const cand = await withOrgContext(
      orgA,
      (db) =>
        db.candidateDatapoint.findFirst({
          where: { documentId, metricKey: 'scope1_tco2e', status: 'pending' },
        }),
      prisma,
    );
    const { datapointId, evidenceId } = await withOrgContext(
      orgA,
      (db) =>
        promoteCandidate(db, {
          organizationId: orgA,
          candidateId: cand!.id,
          actorUserId: userA,
          subjectType: 'organization',
          subjectId: orgA,
          requestId: 'test',
        }),
      prisma,
    );

    const [dp, ev, link, updated] = await withOrgContext(
      orgA,
      async (db) => [
        await db.datapoint.findUnique({ where: { id: datapointId } }),
        await db.evidence.findUnique({ where: { id: evidenceId } }),
        await db.datapointEvidence.findUnique({
          where: { datapointId_evidenceId: { datapointId, evidenceId } },
        }),
        await db.candidateDatapoint.findUnique({ where: { id: cand!.id } }),
      ],
      prisma,
    );
    expect(dp?.label).toBe('human_reviewed');
    expect(dp?.valueNumeric?.toString()).toBe('1303');
    expect(ev?.documentId).toBe(documentId);
    expect(ev?.status).toBe('extracted');
    expect(link).not.toBeNull();
    expect(updated?.status).toBe('promoted');
    expect(updated?.promotedDatapointId).toBe(datapointId);
  });

  it('rejects a candidate', async () => {
    const cand = await withOrgContext(
      orgA,
      (db) =>
        db.candidateDatapoint.findFirst({ where: { documentId, status: 'pending' } }),
      prisma,
    );
    await withOrgContext(
      orgA,
      (db) =>
        rejectCandidate(db, {
          organizationId: orgA,
          candidateId: cand!.id,
          actorUserId: userA,
          note: 'Not relevant.',
          requestId: 'test',
        }),
      prisma,
    );
    const after = await withOrgContext(
      orgA,
      (db) => db.candidateDatapoint.findUnique({ where: { id: cand!.id } }),
      prisma,
    );
    expect(after?.status).toBe('rejected');
  });

  it('keeps a verifiable audit chain', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('does not leak AI data across tenants (RLS)', async () => {
    const counts = await withOrgContext(
      orgB,
      async (db) => ({
        jobs: await db.aiJob.count(),
        candidates: await db.candidateDatapoint.count(),
        extractions: await db.documentExtraction.count(),
      }),
      prisma,
    );
    expect(counts).toEqual({ jobs: 0, candidates: 0, extractions: 0 });
  });
});
