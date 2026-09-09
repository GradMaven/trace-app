import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '@trace/domain';
import {
  authenticateApiKey,
  createApiKey,
  createPrisma,
  createWebhookEndpoint,
  dispatchDueWebhookDeliveries,
  listApiKeys,
  listWebhookDeliveries,
  listWebhookEndpoints,
  provisionOrganization,
  revokeApiKey,
  sendTestWebhook,
  verifyAuditChain,
  withOrgContext,
  writeAuditLog,
  type PrismaClient,
  type WebhookFetch,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

/** A stub HTTP transport for the dispatcher. */
function stubFetch(
  handler: (url: string, headers: Record<string, string>, body: string) => number,
) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetch: WebhookFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const status = handler(url, init.headers, init.body);
    return { status, text: async () => (status >= 200 && status < 300 ? 'ok' : 'boom') };
  };
  return { fetch, calls };
}

run('enterprise access: API keys + outbound webhooks', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

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
            slug: `a-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates a scoped API key that authenticates and never carries admin permissions', async () => {
    const created = await withOrgContext(
      orgA,
      (db) =>
        createApiKey(db, {
          organizationId: orgA,
          name: 'CI export',
          scopes: ['read:all', 'ask:use'],
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(created.token.startsWith('trk_')).toBe(true);
    expect(created.permissions).toContain('activity.read');
    expect(created.permissions).toContain('ask.use');
    expect(created.permissions).not.toContain('member.invite');
    expect(created.permissions).not.toContain('apikey.manage');

    const auth = await authenticateApiKey(prisma, created.token);
    expect(auth?.organizationId).toBe(orgA);
    expect(auth?.apiKeyId).toBe(created.id);
    expect(auth?.permissions).toEqual(created.permissions);

    // lastUsedAt gets stamped.
    const listed = await withOrgContext(orgA, (db) => listApiKeys(db, orgA), prisma);
    expect(listed[0]!.lastUsedAt).not.toBeNull();
    // secret is never surfaced
    expect(JSON.stringify(listed)).not.toContain(created.token.split('_').pop());
  });

  it('rejects malformed, unknown, and revoked keys', async () => {
    expect(await authenticateApiKey(prisma, 'not-a-key')).toBeNull();
    expect(await authenticateApiKey(prisma, 'trk_abcdefghijkl_deadbeefdeadbeef')).toBeNull();

    const k = await withOrgContext(
      orgA,
      (db) =>
        createApiKey(db, {
          organizationId: orgA,
          name: 'to be revoked',
          scopes: ['read:all'],
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(await authenticateApiKey(prisma, k.token)).not.toBeNull();
    await withOrgContext(
      orgA,
      (db) =>
        revokeApiKey(db, {
          organizationId: orgA,
          apiKeyId: k.id,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(await authenticateApiKey(prisma, k.token)).toBeNull();
  });

  it('fans out a webhook delivery from the audit stream and signs it', async () => {
    const endpoint = await withOrgContext(
      orgA,
      (db) =>
        createWebhookEndpoint(db, {
          organizationId: orgA,
          url: 'https://example.test/hook',
          events: ['calculation.approved', 'evidence.verified'],
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );

    // A mapped action queues one delivery per subscribed endpoint...
    await withOrgContext(
      orgA,
      (db) =>
        writeAuditLog(db, {
          organizationId: orgA,
          actorId: userA,
          action: 'calculation.approved',
          resourceType: 'calculation',
          resourceId: 'calc-1',
          before: null,
          after: { approvedBy: userA },
          requestId: 'test',
        }),
      prisma,
    );
    // ...an unmapped one queues nothing.
    await withOrgContext(
      orgA,
      (db) =>
        writeAuditLog(db, {
          organizationId: orgA,
          actorId: userA,
          action: 'activity.updated',
          resourceType: 'activity_data',
          resourceId: 'act-1',
          before: null,
          after: {},
          requestId: 'test',
        }),
      prisma,
    );

    const pending = await withOrgContext(orgA, (db) => listWebhookDeliveries(db, orgA), prisma);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.event).toBe('calculation.approved');
    expect(pending[0]!.status).toBe('pending');
    expect((pending[0]!.payload as { resource: { id: string } }).resource.id).toBe('calc-1');

    const ok = stubFetch(() => 200);
    const res = await dispatchDueWebhookDeliveries(prisma, { fetch: ok.fetch });
    expect(res).toMatchObject({ attempted: 1, succeeded: 1 });

    const sig = ok.calls[0]!.headers[WEBHOOK_SIGNATURE_HEADER]!;
    expect(verifyWebhookSignature(endpoint.secret, sig, ok.calls[0]!.body)).toBe(true);

    const after = await withOrgContext(orgA, (db) => listWebhookDeliveries(db, orgA), prisma);
    expect(after[0]!.status).toBe('succeeded');
    expect(after[0]!.responseStatus).toBe(200);
    const eps = await withOrgContext(orgA, (db) => listWebhookEndpoints(db, orgA), prisma);
    expect(eps[0]!.lastSuccessAt).not.toBeNull();
    expect(eps[0]!.consecutiveFailures).toBe(0);
  });

  it('retries a failing delivery with backoff and eventually marks it dead', async () => {
    await withOrgContext(
      orgA,
      (db) =>
        createWebhookEndpoint(db, {
          organizationId: orgA,
          url: 'https://example.test/broken',
          events: ['trust.scan_completed'],
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    await withOrgContext(
      orgA,
      (db) =>
        writeAuditLog(db, {
          organizationId: orgA,
          actorId: userA,
          action: 'quality.scan_completed',
          resourceType: 'quality_scan',
          resourceId: 'scan-1',
          before: null,
          after: { scored: 3 },
          requestId: 'test',
        }),
      prisma,
    );

    const fail = stubFetch(() => 500);
    let dead = false;
    for (let i = 0; i < 8 && !dead; i += 1) {
      // force every attempt to be "due" by sweeping with an ever-later clock
      await dispatchDueWebhookDeliveries(prisma, {
        fetch: fail.fetch,
        now: new Date(Date.now() + i * 3 * 3600_000),
      });
      const rows = await withOrgContext(
        orgA,
        (db) => listWebhookDeliveries(db, orgA, { limit: 5 }),
        prisma,
      );
      const broken = rows.find((r) => r.event === 'trust.scan_completed')!;
      dead = broken.status === 'dead';
      if (!dead) expect(['pending', 'delivering']).toContain(broken.status);
    }
    expect(dead).toBe(true);
  });

  it('queues a ping from the endpoint test action', async () => {
    const eps = await withOrgContext(orgA, (db) => listWebhookEndpoints(db, orgA), prisma);
    const target = eps.find((e) => e.url === 'https://example.test/hook')!;
    const { deliveryId } = await withOrgContext(
      orgA,
      (db) =>
        sendTestWebhook(db, {
          organizationId: orgA,
          endpointId: target.id,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const rows = await withOrgContext(
      orgA,
      (db) => listWebhookDeliveries(db, orgA, { endpointId: target.id, limit: 10 }),
      prisma,
    );
    expect(rows.some((r) => r.id === deliveryId && r.event === 'ping')).toBe(true);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bKeys = await withOrgContext(orgB, (db) => listApiKeys(db, orgB), prisma);
    const bHooks = await withOrgContext(orgB, (db) => listWebhookEndpoints(db, orgB), prisma);
    const bDeliveries = await withOrgContext(orgB, (db) => listWebhookDeliveries(db, orgB), prisma);
    expect(bKeys).toEqual([]);
    expect(bHooks).toEqual([]);
    expect(bDeliveries).toEqual([]);

    // orgB cannot authenticate with... nothing, and RLS blocks a raw endpoint read.
    const leaked = await withOrgContext(orgB, (db) => db.webhookEndpoint.count(), prisma);
    expect(leaked).toBe(0);
  });
});
