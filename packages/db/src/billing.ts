import {
  BILLING_FALLBACK_PLAN,
  billingEventOutcome,
  generateBillingWebhookSecret,
  invalidPlanKeysInMap,
  normalizeBillingEvent,
  priceForPlan,
  verifyBillingSignature,
  type BillingOutcome,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { withOrgContext, type PrismaClient, type TenantDb } from './client';
import { writeAuditLog } from './audit';
import { ensureSubscription, setPlan, type SubscriptionView } from './metering';

/**
 * Billing-provider integration (Phase 13h) — the Stripe-shaped slice.
 *
 * `billing_config` (holds the provider secret key + the webhook signing secret +
 * the price→plan map) is RLS-forced; `billing_event` / `billing_checkout` are
 * system-written logs. All provider network calls are an injected
 * `BillingProviderAdapter` so the CI test can stub them; inbound webhooks are
 * verified with the same `t=,v1=` HMAC scheme as outbound webhooks and applied
 * to the Phase-13c `subscription` via `setPlan`.
 */

// ---------------------------------------------------------------------------
// Provider adapter (injected)
// ---------------------------------------------------------------------------

export interface BillingProviderAdapter {
  createCheckoutSession(input: {
    secretKey: string;
    priceId: string;
    planKey: string;
    customerId: string | null;
    clientReferenceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string; customerId: string | null }>;
  createPortalSession(input: {
    secretKey: string;
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}

export interface BillingDeps {
  adapter: BillingProviderAdapter;
  now?: Date;
}

// ---------------------------------------------------------------------------
// Config (org-scoped, admin)
// ---------------------------------------------------------------------------

export interface BillingConfigInput {
  provider: string;
  enabled: boolean;
  publishableKey?: string | null;
  /** Omit on update to keep the stored key. */
  secretKey?: string | null;
  /** Omit on update to keep the stored secret. Send an empty string to clear. */
  webhookSecret?: string | null;
  priceToPlan: Record<string, string>;
}

export interface BillingConfigView {
  provider: string;
  enabled: boolean;
  publishableKey: string | null;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  priceToPlan: Record<string, string>;
  customerId: string | null;
  subscriptionRef: string | null;
}

function readPriceMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export async function upsertBillingConfig(
  db: TenantDb,
  args: {
    organizationId: string;
    config: BillingConfigInput;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ webhookSecret?: string }> {
  const c = args.config;
  const priceToPlan = readPriceMap(c.priceToPlan);
  const badPlans = invalidPlanKeysInMap(priceToPlan);
  if (badPlans.length > 0) {
    throw AppError.unprocessable(
      'billing.unknown_plan',
      `Price map references unknown plan(s): ${badPlans.join(', ')}.`,
    );
  }

  const existing = await db.billingConfig.findUnique({
    where: { organizationId: args.organizationId },
  });

  // Webhook secret: explicit value wins; '' clears; undefined keeps; first-time
  // configuration without one mints a fresh secret and returns it once.
  let webhookSecret: string | null | undefined;
  let mintedSecret: string | undefined;
  if (c.webhookSecret === undefined) {
    webhookSecret = existing?.webhookSecret ?? null;
    if (!webhookSecret && c.enabled) {
      mintedSecret = generateBillingWebhookSecret().secret;
      webhookSecret = mintedSecret;
    }
  } else if (c.webhookSecret === '') {
    webhookSecret = null;
  } else {
    webhookSecret = c.webhookSecret;
  }

  const secretKey =
    c.secretKey === undefined ? (existing?.secretKey ?? null) : c.secretKey || null;

  const data = {
    provider: c.provider || 'stripe',
    enabled: c.enabled,
    publishableKey: c.publishableKey?.trim() || null,
    secretKey,
    webhookSecret: webhookSecret ?? null,
    priceToPlan,
  };
  await db.billingConfig.upsert({
    where: { organizationId: args.organizationId },
    create: {
      organizationId: args.organizationId,
      createdByUserId: args.actorUserId,
      ...data,
    },
    update: data,
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: existing ? 'billing.provider_updated' : 'billing.provider_configured',
    resourceType: 'billing_config',
    resourceId: args.organizationId,
    before: existing ? { provider: existing.provider, enabled: existing.enabled } : null,
    after: { provider: data.provider, enabled: data.enabled },
    requestId: args.requestId,
  });
  return mintedSecret ? { webhookSecret: mintedSecret } : {};
}

export async function getBillingConfig(
  db: TenantDb,
  organizationId: string,
): Promise<BillingConfigView | null> {
  const c = await db.billingConfig.findUnique({ where: { organizationId } });
  if (!c) return null;
  return {
    provider: c.provider,
    enabled: c.enabled,
    publishableKey: c.publishableKey,
    hasSecretKey: Boolean(c.secretKey),
    hasWebhookSecret: Boolean(c.webhookSecret),
    priceToPlan: readPriceMap(c.priceToPlan),
    customerId: c.customerId,
    subscriptionRef: c.subscriptionRef,
  };
}

export async function rotateBillingWebhookSecret(
  db: TenantDb,
  args: { organizationId: string; actorUserId: string; requestId: string },
): Promise<{ webhookSecret: string }> {
  const c = await db.billingConfig.findUnique({ where: { organizationId: args.organizationId } });
  if (!c) throw AppError.notFound('billing.not_configured', 'Billing is not configured.');
  const secret = generateBillingWebhookSecret().secret;
  await db.billingConfig.update({ where: { id: c.id }, data: { webhookSecret: secret } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'billing.webhook_secret_rotated',
    resourceType: 'billing_config',
    resourceId: args.organizationId,
    before: null,
    after: null,
    requestId: args.requestId,
  });
  return { webhookSecret: secret };
}

export async function deleteBillingConfig(
  db: TenantDb,
  args: { organizationId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const c = await db.billingConfig.findUnique({ where: { organizationId: args.organizationId } });
  if (!c) throw AppError.notFound('billing.not_configured', 'Billing is not configured.');
  await db.billingConfig.delete({ where: { id: c.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'billing.provider_removed',
    resourceType: 'billing_config',
    resourceId: args.organizationId,
    before: { provider: c.provider },
    after: null,
    requestId: args.requestId,
  });
}

// ---------------------------------------------------------------------------
// Checkout + portal (console-initiated)
// ---------------------------------------------------------------------------

export async function startCheckout(
  db: TenantDb,
  deps: BillingDeps,
  args: {
    organizationId: string;
    planKey: string;
    actorUserId: string;
    requestId: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<{ url: string }> {
  const c = await db.billingConfig.findUnique({ where: { organizationId: args.organizationId } });
  if (!c || !c.enabled) {
    throw AppError.unprocessable('billing.not_enabled', 'Billing is not enabled for this workspace.');
  }
  if (!c.secretKey) {
    throw AppError.unprocessable('billing.no_secret_key', 'A provider secret key is required.');
  }
  const priceId = priceForPlan(args.planKey, readPriceMap(c.priceToPlan));
  if (!priceId) {
    throw AppError.unprocessable(
      'billing.no_price',
      `No provider price is mapped to the "${args.planKey}" plan.`,
    );
  }

  const checkout = await db.billingCheckout.create({
    data: {
      organizationId: args.organizationId,
      planKey: args.planKey,
      createdByUserId: args.actorUserId,
    },
  });

  const session = await deps.adapter.createCheckoutSession({
    secretKey: c.secretKey,
    priceId,
    planKey: args.planKey,
    customerId: c.customerId,
    clientReferenceId: args.organizationId,
    successUrl: args.successUrl,
    cancelUrl: args.cancelUrl,
  });

  await db.billingCheckout.update({
    where: { id: checkout.id },
    data: { providerRef: session.sessionId },
  });
  if (session.customerId && session.customerId !== c.customerId) {
    await db.billingConfig.update({
      where: { id: c.id },
      data: { customerId: session.customerId },
    });
  }
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'billing.checkout_started',
    resourceType: 'billing_checkout',
    resourceId: checkout.id,
    before: null,
    after: { planKey: args.planKey },
    requestId: args.requestId,
  });
  return { url: session.url };
}

export async function billingPortalUrl(
  db: TenantDb,
  deps: BillingDeps,
  args: { organizationId: string; returnUrl: string },
): Promise<{ url: string }> {
  const c = await db.billingConfig.findUnique({ where: { organizationId: args.organizationId } });
  if (!c || !c.enabled || !c.secretKey) {
    throw AppError.unprocessable('billing.not_enabled', 'Billing is not enabled for this workspace.');
  }
  if (!c.customerId) {
    throw AppError.unprocessable(
      'billing.no_customer',
      'No billing customer yet — start a checkout first.',
    );
  }
  const { url } = await deps.adapter.createPortalSession({
    secretKey: c.secretKey,
    customerId: c.customerId,
    returnUrl: args.returnUrl,
  });
  return { url };
}

// ---------------------------------------------------------------------------
// Webhook ingestion
// ---------------------------------------------------------------------------

export interface HandleBillingWebhookResult {
  handled: boolean;
  duplicate: boolean;
  type: string;
  outcome: BillingOutcome | null;
}

export async function handleBillingWebhook(
  prisma: PrismaClient,
  args: { orgSlug: string; signatureHeader: string; rawBody: string; requestId: string; now?: Date },
): Promise<HandleBillingWebhookResult> {
  const now = args.now ?? new Date();
  const org = await prisma.organization.findUnique({
    where: { slug: args.orgSlug.trim().toLowerCase() },
  });
  if (!org) throw AppError.notFound('billing.org_not_found', 'No workspace with that identifier.');

  const config = await withOrgContext(
    org.id,
    (db) => db.billingConfig.findUnique({ where: { organizationId: org.id } }),
    prisma,
  );
  if (!config || !config.enabled || !config.webhookSecret) {
    throw AppError.unprocessable('billing.not_enabled', 'Billing webhooks are not enabled.');
  }
  if (!verifyBillingSignature(config.webhookSecret, args.signatureHeader, args.rawBody, now)) {
    throw AppError.unauthenticated('billing.bad_signature', 'Invalid billing webhook signature.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(args.rawBody);
  } catch {
    throw AppError.unprocessable('billing.bad_event', 'Webhook body is not valid JSON.');
  }
  const event = normalizeBillingEvent(parsed);
  if (!event) {
    throw AppError.unprocessable('billing.bad_event', 'Unrecognised webhook event shape.');
  }

  const priceToPlan = readPriceMap(config.priceToPlan);
  const outcome = billingEventOutcome(event, priceToPlan);

  return withOrgContext(
    org.id,
    async (db) => {
      const seen = await db.billingEvent.findUnique({
        where: { providerEventId: event.id },
      });
      if (seen) {
        return { handled: false, duplicate: true, type: event.type, outcome: null };
      }

      await ensureSubscription(db, org.id, now);
      if (outcome.planKey) {
        await setPlan(db, {
          organizationId: org.id,
          planKey: outcome.planKey,
          actorUserId: config.createdByUserId,
          requestId: args.requestId,
          now,
        });
      }
      if (outcome.status) {
        await db.subscription
          .update({ where: { organizationId: org.id }, data: { status: outcome.status } })
          .catch(() => undefined);
      }

      const configPatch: Record<string, string> = {};
      if (event.customerId && event.customerId !== config.customerId) {
        configPatch.customerId = event.customerId;
      }
      if (event.subscriptionId && event.subscriptionId !== config.subscriptionRef) {
        configPatch.subscriptionRef = event.subscriptionId;
      }
      if (Object.keys(configPatch).length > 0) {
        await db.billingConfig.update({ where: { id: config.id }, data: configPatch });
      }

      if (event.type === 'checkout.completed') {
        // Complete the matching session, else the org's outstanding pending ones.
        const bySession = await db.billingCheckout.updateMany({
          where: { organizationId: org.id, status: 'pending', providerRef: event.sessionId ?? '' },
          data: { status: 'completed', completedAt: now },
        });
        if (bySession.count === 0) {
          await db.billingCheckout.updateMany({
            where: { organizationId: org.id, status: 'pending' },
            data: { status: 'completed', completedAt: now },
          });
        }
      }

      const applied = Boolean(outcome.planKey || outcome.status);
      await db.billingEvent.create({
        data: {
          organizationId: org.id,
          providerEventId: event.id,
          type: event.type,
          status: applied ? 'processed' : 'ignored',
          outcome: { planKey: outcome.planKey, status: outcome.status, reason: outcome.reason },
        },
      });
      await writeAuditLog(db, {
        organizationId: org.id,
        actorId: config.createdByUserId,
        action: 'billing.webhook_processed',
        resourceType: 'billing_event',
        resourceId: event.id,
        before: null,
        after: { type: event.type, planKey: outcome.planKey, status: outcome.status },
        requestId: args.requestId,
      });
      return { handled: applied, duplicate: false, type: event.type, outcome };
    },
    prisma,
  );
}

// ---------------------------------------------------------------------------
// Console overview + housekeeping
// ---------------------------------------------------------------------------

export interface BillingOverview {
  config: BillingConfigView | null;
  subscription: SubscriptionView;
  recentEvents: Array<{
    providerEventId: string;
    type: string;
    status: string;
    receivedAt: string;
  }>;
}

export async function billingOverview(
  db: TenantDb,
  organizationId: string,
): Promise<BillingOverview> {
  const [config, subscription, events] = await Promise.all([
    getBillingConfig(db, organizationId),
    ensureSubscription(db, organizationId),
    db.billingEvent.findMany({
      where: { organizationId },
      orderBy: { receivedAt: 'desc' },
      take: 20,
    }),
  ]);
  return {
    config,
    subscription,
    recentEvents: events.map((e) => ({
      providerEventId: e.providerEventId,
      type: e.type,
      status: e.status,
      receivedAt: e.receivedAt.toISOString(),
    })),
  };
}

/** Worker housekeeping: mark pending checkouts older than `maxAgeMs` as expired. */
export async function expireStaleCheckouts(
  prisma: PrismaClient,
  maxAgeMs = 60 * 60_000,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.billingCheckout.updateMany({
    where: { status: 'pending', createdAt: { lt: new Date(now.getTime() - maxAgeMs) } },
    data: { status: 'expired' },
  });
  return res.count;
}

export { BILLING_FALLBACK_PLAN };
