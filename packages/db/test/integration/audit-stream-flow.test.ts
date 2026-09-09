import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPrometheus, verifyWebhookSignature } from '@trace/domain';
import {
  createAuditStream,
  createPrisma,
  dispatchOrgAuditStreams,
  listAuditStreamDeliveries,
  listAuditStreams,
  orgStats,
  platformMetrics,
  provisionOrganization,
  sendTestAuditStream,
  verifyAuditChain,
  withOrgContext,
  writeAuditLog,
  type PrismaClient,
  type WebhookFetch,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;
const SIG_HEADER = 'x-trace-signature';

function stubFetch(status: (body: string) => number) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetch: WebhookFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const s = status(init.body);
    return { status: s, text: async () => (s >= 200 && s < 300 ? 'ok' : 'boom') };
  };
  return { fetch, calls };
}

async function audit(
  prisma: PrismaClient,
  org: string,
  actor: string,
  action: string,
  resourceType: string,
) {
  await withOrgContext(
    org,
    (db) =>
      writeAuditLog(db, {
        organizationId: org,
        actorId: actor,
        action,
        resourceType,
        resourceId: randomUUID(),
        before: null,
        after: {},
        requestId: 'test',
      }),
    prisma,
  );
}

run('audit streaming: cursor-tail + signed batch + retry + metrics', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let streamId = '';
  let secret = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `sa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `sb-${userB}@test.example`, name: 'B' },
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
            slug: `s-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }
    const created = await withOrgContext(
      orgA,
      (db) =>
        createAuditStream(db, {
          organizationId: orgA,
          name: 'SIEM',
          url: 'https://siem.test/ingest',
          filters: { actionPrefixes: ['billing.', 'audit_stream.'] },
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    streamId = created.id;
    secret = created.secret;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('sends only matching entries as a signed batch and advances the cursor', async () => {
    await audit(prisma, orgA, userA, 'billing.plan_changed', 'subscription');
    await audit(prisma, orgA, userA, 'evidence.created', 'evidence'); // filtered out
    await audit(prisma, orgA, userA, 'billing.plan_changed', 'subscription');

    const ok = stubFetch(() => 200);
    const res = await withOrgContext(
      orgA,
      (db) => dispatchOrgAuditStreams(db, { fetch: ok.fetch }),
      prisma,
    );
    expect(res).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });

    const body = JSON.parse(ok.calls[0]!.body) as { count: number; entries: { action: string }[] };
    expect(body.count).toBe(2);
    expect(body.entries.every((e) => e.action.startsWith('billing.'))).toBe(true);
    expect(
      verifyWebhookSignature(secret, ok.calls[0]!.headers[SIG_HEADER]!, ok.calls[0]!.body),
    ).toBe(true);

    // Nothing new -> nothing attempted.
    const res2 = await withOrgContext(
      orgA,
      (db) => dispatchOrgAuditStreams(db, { fetch: ok.fetch }),
      prisma,
    );
    expect(res2.attempted).toBe(0);

    const streams = await withOrgContext(orgA, (db) => listAuditStreams(db, orgA), prisma);
    expect(streams[0]!.cursor).not.toBeNull();
    expect(streams[0]!.lastDeliveryAt).not.toBeNull();
  });

  it('retries a failed delivery with backoff and does not advance the cursor until it succeeds', async () => {
    const before = (await withOrgContext(orgA, (db) => listAuditStreams(db, orgA), prisma))[0]!
      .cursor;
    await audit(prisma, orgA, userA, 'audit_stream.updated', 'audit_stream');

    const fail = stubFetch(() => 500);
    const r1 = await withOrgContext(
      orgA,
      (db) => dispatchOrgAuditStreams(db, { fetch: fail.fetch }),
      prisma,
    );
    expect(r1).toMatchObject({ attempted: 1, failed: 1 });
    const midCursor = (await withOrgContext(orgA, (db) => listAuditStreams(db, orgA), prisma))[0]!
      .cursor;
    expect(midCursor).toBe(before); // not advanced

    const deliveries = await withOrgContext(
      orgA,
      (db) => listAuditStreamDeliveries(db, orgA),
      prisma,
    );
    expect(deliveries[0]!.status).toBe('failed');
    expect(deliveries[0]!.nextAttemptAt).not.toBeNull();

    const ok = stubFetch(() => 200);
    const r2 = await withOrgContext(
      orgA,
      (db) =>
        dispatchOrgAuditStreams(db, { fetch: ok.fetch, now: new Date(Date.now() + 5 * 60_000) }),
      prisma,
    );
    expect(r2).toMatchObject({ attempted: 1, succeeded: 1 });
    const afterCursor = (await withOrgContext(orgA, (db) => listAuditStreams(db, orgA), prisma))[0]!
      .cursor;
    expect(afterCursor).not.toBe(before); // advanced now
  });

  it('delivers a synthetic ping from the test action', async () => {
    const cursorBefore = (
      await withOrgContext(orgA, (db) => listAuditStreams(db, orgA), prisma)
    )[0]!.cursor;
    const { deliveryId } = await withOrgContext(
      orgA,
      (db) =>
        sendTestAuditStream(db, {
          organizationId: orgA,
          streamId,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const ok = stubFetch(() => 200);
    await withOrgContext(orgA, (db) => dispatchOrgAuditStreams(db, { fetch: ok.fetch }), prisma);
    const rows = await withOrgContext(
      orgA,
      (db) => listAuditStreamDeliveries(db, orgA, { limit: 10 }),
      prisma,
    );
    expect(rows.find((r) => r.id === deliveryId)?.status).toBe('succeeded');
    const pingBody = JSON.parse(ok.calls[0]!.body) as { entries: { action: string }[] };
    expect(pingBody.entries[0]!.action).toBe('audit_stream.ping');
    // a test does not move the real cursor
    const cursorAfter = (await withOrgContext(orgA, (db) => listAuditStreams(db, orgA), prisma))[0]!
      .cursor;
    expect(cursorAfter).toBe(cursorBefore);
  });

  it('reports org stats and process metrics', async () => {
    const stats = await withOrgContext(orgA, (db) => orgStats(db, orgA), prisma);
    expect(stats.members).toBeGreaterThanOrEqual(1);
    expect(stats.auditEntries).toBeGreaterThan(0);
    expect(stats.auditStreams).toBe(1);

    const samples = await platformMetrics(prisma);
    expect(samples.some((s) => s.name === 'trace_organizations_total')).toBe(true);
    const text = renderPrometheus(samples);
    expect(text).toMatch(/# HELP trace_organizations_total/);
    expect(text).toMatch(/# TYPE trace_audit_entries_total counter/);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bStreams = await withOrgContext(orgB, (db) => listAuditStreams(db, orgB), prisma);
    expect(bStreams).toEqual([]);
    const bCount = await withOrgContext(orgB, (db) => db.auditStream.count(), prisma);
    expect(bCount).toBe(0);
  });
});
