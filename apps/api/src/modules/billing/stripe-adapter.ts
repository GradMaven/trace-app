import type { BillingProviderAdapter } from '@trace/db';

const STRIPE_API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 8_000;

/** Flatten a nested object into Stripe's `a[b][c]=v` form-encoding. */
function toForm(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) {
      out.push(...toForm(v as Record<string, unknown>, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function stripePost(
  path: string,
  secretKey: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: toForm(body).join('&'),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(`Stripe ${path} returned ${res.status}: ${err?.message ?? 'unknown error'}`);
  }
  return json;
}

/**
 * The real Stripe implementation of `BillingProviderAdapter` (Phase 13h). Only
 * exercised once an admin configures a live secret key; the CI test injects a
 * stub instead.
 */
export const stripeBillingAdapter: BillingProviderAdapter = {
  async createCheckoutSession(input) {
    const session = await stripePost('/checkout/sessions', input.secretKey, {
      mode: 'subscription',
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': 1,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      ...(input.customerId ? { customer: input.customerId } : {}),
      metadata: { trace_org: input.clientReferenceId, trace_plan: input.planKey },
      subscription_data: { metadata: { trace_org: input.clientReferenceId } },
    });
    return {
      url: String(session.url ?? ''),
      sessionId: String(session.id ?? ''),
      customerId: typeof session.customer === 'string' ? session.customer : null,
    };
  },

  async createPortalSession(input) {
    const session = await stripePost('/billing_portal/sessions', input.secretKey, {
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: String(session.url ?? '') };
  },
};
