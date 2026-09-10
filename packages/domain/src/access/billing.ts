import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEFAULT_PLAN_KEY, isPlanKey } from './metering';

/**
 * Billing-provider integration (Phase 13h) — pure. Webhook signature
 * verification (the Stripe-style `t=<ts>,v1=<hmac-sha256>` scheme), normalisation
 * of a provider event into a canonical shape, and the rule that turns an event +
 * the per-org price→plan map into a subscription outcome. All provider I/O
 * (creating a checkout / portal session) is an injected `BillingProviderAdapter`
 * in `@trace/db`; this module never touches the network.
 */

export const BILLING_PROVIDERS = ['stripe', 'test'] as const;
export type BillingProviderKey = (typeof BILLING_PROVIDERS)[number];

export const BILLING_SIGNATURE_HEADER = 'x-trace-billing-signature';
export const BILLING_SIGNATURE_TOLERANCE_SECONDS = 300;
export const BILLING_WEBHOOK_SECRET_PREFIX = 'whsec_';

/** The plan an org falls back to when a subscription is cancelled or lapses. */
export const BILLING_FALLBACK_PLAN = DEFAULT_PLAN_KEY;

// ---------------------------------------------------------------------------
// Webhook secret + signature (t=<ts>,v1=<hmac>)
// ---------------------------------------------------------------------------

export function generateBillingWebhookSecret(): { secret: string } {
  return { secret: `${BILLING_WEBHOOK_SECRET_PREFIX}${randomBytes(24).toString('base64url')}` };
}

function signingBase(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

export function signBillingPayload(
  secret: string,
  timestampSeconds: number,
  body: string,
): string {
  const mac = createHmac('sha256', secret).update(signingBase(timestampSeconds, body)).digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

/** Verify a received `x-trace-billing-signature` header against the raw body. */
export function verifyBillingSignature(
  secret: string,
  header: string,
  body: string,
  now: Date = new Date(),
): boolean {
  if (!secret || !header) return false;
  const parts: Record<string, string> = {};
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(ts) || !v1) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > BILLING_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(signingBase(ts, body)).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Event normalisation
// ---------------------------------------------------------------------------

export type BillingEventType =
  | 'checkout.completed'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'payment.failed'
  | 'unknown';

export interface NormalizedBillingEvent {
  /** The provider's event id — the idempotency key. */
  id: string;
  type: BillingEventType;
  createdAt: number;
  priceId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  /** The checkout session id, for `checkout.completed` events. */
  sessionId: string | null;
  /** Our organization id, passed through `client_reference_id` / metadata. */
  clientReferenceId: string | null;
  /** Explicit plan key on the checkout session's `metadata.trace_plan`, if any. */
  requestedPlanKey: string | null;
  /** The provider's subscription status string, when the event carries one. */
  providerStatus: string | null;
  raw: Record<string, unknown>;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const TYPE_MAP: Record<string, BillingEventType> = {
  'checkout.session.completed': 'checkout.completed',
  'customer.subscription.created': 'subscription.updated',
  'customer.subscription.updated': 'subscription.updated',
  'customer.subscription.deleted': 'subscription.canceled',
  'invoice.payment_failed': 'payment.failed',
};

/**
 * Map a raw Stripe-shaped event object to the canonical form. Returns null only
 * when the envelope is unusable (no `id`, no `data.object`).
 */
export function normalizeBillingEvent(raw: unknown): NormalizedBillingEvent | null {
  const evt = asRecord(raw);
  if (!evt) return null;
  const id = asString(evt.id);
  const providerType = asString(evt.type) ?? '';
  const data = asRecord(evt.data);
  const object = data ? asRecord(data.object) : null;
  if (!id || !object) return null;

  const type = TYPE_MAP[providerType] ?? 'unknown';
  const metadata = asRecord(object.metadata) ?? {};
  const items = asRecord(object.items);
  const firstItem = items && Array.isArray(items.data) ? asRecord(items.data[0]) : null;
  const price = firstItem ? asRecord(firstItem.price) : asRecord(object.price);

  const customerId =
    asString(object.customer) ??
    (asRecord(object.customer) ? asString(asRecord(object.customer)!.id) : null);
  const subscriptionId =
    asString(object.subscription) ?? (type.startsWith('subscription') ? asString(object.id) : null);

  return {
    id,
    type,
    createdAt: typeof evt.created === 'number' ? evt.created : Math.floor(Date.now() / 1000),
    priceId: price ? asString(price.id) : null,
    customerId,
    subscriptionId,
    sessionId: type === 'checkout.completed' ? asString(object.id) : null,
    clientReferenceId: asString(object.client_reference_id) ?? asString(metadata.trace_org),
    requestedPlanKey: asString(metadata.trace_plan),
    providerStatus: asString(object.status),
    raw: evt,
  };
}

// ---------------------------------------------------------------------------
// Event → subscription outcome
// ---------------------------------------------------------------------------

export function resolvePlanForPrice(
  priceId: string | null,
  priceToPlan: Record<string, string>,
): string | null {
  if (!priceId) return null;
  const key = priceToPlan[priceId];
  return key && isPlanKey(key) ? key : null;
}

/** Reverse lookup: the provider price id mapped to a plan key (first match). */
export function priceForPlan(
  planKey: string,
  priceToPlan: Record<string, string>,
): string | null {
  for (const [priceId, plan] of Object.entries(priceToPlan)) {
    if (plan === planKey) return priceId;
  }
  return null;
}

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled';

export interface BillingOutcome {
  /** Set → the caller should `setPlan` to this key. */
  planKey: string | null;
  /** Set → the caller should update `subscription.status`. */
  status: SubscriptionStatus | null;
  reason: string;
}

function statusFromProvider(providerStatus: string | null): SubscriptionStatus | null {
  switch (providerStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return null;
  }
}

/** Decide what a normalised event means for the org's subscription. Pure. */
export function billingEventOutcome(
  event: NormalizedBillingEvent,
  priceToPlan: Record<string, string>,
): BillingOutcome {
  switch (event.type) {
    case 'checkout.completed': {
      const planKey =
        (event.requestedPlanKey && isPlanKey(event.requestedPlanKey)
          ? event.requestedPlanKey
          : null) ?? resolvePlanForPrice(event.priceId, priceToPlan);
      return planKey
        ? { planKey, status: 'active', reason: 'checkout completed' }
        : { planKey: null, status: 'active', reason: 'checkout completed; awaiting subscription event' };
    }
    case 'subscription.updated': {
      const status = statusFromProvider(event.providerStatus) ?? 'active';
      if (status === 'canceled') {
        return { planKey: BILLING_FALLBACK_PLAN, status, reason: 'subscription canceled' };
      }
      const planKey = resolvePlanForPrice(event.priceId, priceToPlan);
      return { planKey, status, reason: planKey ? 'subscription updated' : 'price not mapped' };
    }
    case 'subscription.canceled':
      return {
        planKey: BILLING_FALLBACK_PLAN,
        status: 'canceled',
        reason: 'subscription canceled',
      };
    case 'payment.failed':
      return { planKey: null, status: 'past_due', reason: 'payment failed' };
    default:
      return { planKey: null, status: null, reason: 'event ignored' };
  }
}

/** Validate a price→plan map: every value must be a known plan key. */
export function invalidPlanKeysInMap(priceToPlan: Record<string, string>): string[] {
  return [...new Set(Object.values(priceToPlan).filter((v) => !isPlanKey(v)))];
}
