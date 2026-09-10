import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signBillingPayload } from '@trace/domain';
import {
  billingOverview,
  createPrisma,
  deleteBillingConfig,
  ensureSubscription,
  handleBillingWebhook,
  provisionOrganization,
  startCheckout,
  upsertBillingConfig,
  verifyAuditChain,
  withOrgContext,
  type BillingProviderAdapter,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

const WEBHOOK_SECRET = 'whsec_flowtestsecret';

const stubAdapter: BillingProviderAdapter = {
  async createCheckoutSession(input) {
    return {
      url: `https://pay.test/checkout/${input.priceId}`,
      sessionId: `cs_${input.priceId}`,
      customerId: 'cus_stub_1',
    };
  },
  async createPortalSession() {
    return { url: 'https://pay.test/portal' };
  },
};

function stripeEvent(type: string, object: Record<string, unknown>, id: string) {
  return JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), data: { object } });
}
function signed(body: string) {
  const ts = Math.floor(Date.now() / 1000);
  return { header: signBillingPayload(WEBHOOK_SECRET, ts, body), body };
}

run('Billing: signed webhooks + checkout', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const slugA = `bl-${orgA.slice(0, 8)}`;

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `bla-${userA}@test.example`, name: 'A' },
        { id: userB, email: `blb-${userB}@test.example`, name: 'B' },
      ],
    });
    for (const [org, user, slug] of [
      [orgA, userA, slugA],
      [orgB, userB, `bm-${orgB.slice(0, 8)}`],
    ] as const) {
      await withOrgContext(
        org,
        (db) =>
          provisionOrganization(db, {
            organizationId: org,
            slug,
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
      (db) =>
        upsertBillingConfig(db, {
          organizationId: orgA,
          config: {
            provider: 'test',
            enabled: true,
            secretKey: 'sk_test_123',
            webhookSecret: WEBHOOK_SECRET,
            priceToPlan: { price_growth: 'growth', price_ent: 'enterprise' },
          },
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('hides secrets in the config view', async () => {
    const o = await withOrgContext(orgA, (db) => billingOverview(db, orgA), prisma);
    expect(JSON.stringify(o.config)).not.toContain('sk_test_123');
    expect(JSON.stringify(o.config)).not.toContain(WEBHOOK_SECRET);
    expect(o.config).toMatchObject({ enabled: true, hasSecretKey: true, hasWebhookSecret: true });
  });

  it('starts a checkout through the adapter and records the customer id', async () => {
    const { url } = await withOrgContext(
      orgA,
      (db) =>
        startCheckout(db, { adapter: stubAdapter }, {
          organizationId: orgA,
          planKey: 'growth',
          actorUserId: userA,
          requestId: 'test',
          successUrl: 'https://app.test/ok',
          cancelUrl: 'https://app.test/no',
        }),
      prisma,
    );
    expect(url).toBe('https://pay.test/checkout/price_growth');
    const cfg = await withOrgContext(orgA, (db) => billingOverview(db, orgA), prisma);
    expect(cfg.config?.customerId).toBe('cus_stub_1');
  });

  it('applies a signed subscription.updated event to the plan, idempotently', async () => {
    const { header, body } = signed(
      stripeEvent(
        'customer.subscription.updated',
        {
          id: 'sub_1',
          customer: 'cus_stub_1',
          status: 'active',
          items: { data: [{ price: { id: 'price_ent' } }] },
        },
        'evt_sub_1',
      ),
    );
    const r1 = await handleBillingWebhook(prisma, {
      orgSlug: slugA,
      signatureHeader: header,
      rawBody: body,
      requestId: 'test',
    });
    expect(r1).toMatchObject({ handled: true, duplicate: false, type: 'subscription.updated' });
    const sub = await withOrgContext(orgA, (db) => ensureSubscription(db, orgA), prisma);
    expect(sub.planKey).toBe('enterprise');
    expect(sub.status).toBe('active');

    // replay → idempotent no-op
    const r2 = await handleBillingWebhook(prisma, {
      orgSlug: slugA,
      signatureHeader: header,
      rawBody: body,
      requestId: 'test',
    });
    expect(r2.duplicate).toBe(true);
    const events = await withOrgContext(
      orgA,
      (db) => db.billingEvent.count({ where: { providerEventId: 'evt_sub_1' } }),
      prisma,
    );
    expect(events).toBe(1);
  });

  it('rejects a bad signature and an unknown workspace', async () => {
    const { body } = signed(stripeEvent('customer.subscription.deleted', { id: 'sub_1' }, 'evt_x'));
    await expect(
      handleBillingWebhook(prisma, {
        orgSlug: slugA,
        signatureHeader: 't=1,v1=deadbeef',
        rawBody: body,
        requestId: 'test',
      }),
    ).rejects.toThrow(/signature/i);
  });

  it('a cancellation drops the plan back to free', async () => {
    const { header, body } = signed(
      stripeEvent('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_stub_1' }, 'evt_cancel_1'),
    );
    const r = await handleBillingWebhook(prisma, {
      orgSlug: slugA,
      signatureHeader: header,
      rawBody: body,
      requestId: 'test',
    });
    expect(r.outcome).toMatchObject({ planKey: 'free', status: 'canceled' });
    const sub = await withOrgContext(orgA, (db) => ensureSubscription(db, orgA), prisma);
    expect(sub.planKey).toBe('free');
    expect(sub.status).toBe('canceled');
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
    const bCount = await withOrgContext(orgB, (db) => db.billingConfig.count(), prisma);
    expect(bCount).toBe(0);
    await withOrgContext(
      orgA,
      (db) => deleteBillingConfig(db, { organizationId: orgA, actorUserId: userA, requestId: 'test' }),
      prisma,
    );
  });
});
