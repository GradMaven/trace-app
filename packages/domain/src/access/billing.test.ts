import { describe, expect, it } from 'vitest';
import {
  billingEventOutcome,
  generateBillingWebhookSecret,
  invalidPlanKeysInMap,
  normalizeBillingEvent,
  priceForPlan,
  resolvePlanForPrice,
  signBillingPayload,
  verifyBillingSignature,
} from './billing';

const SECRET = 'whsec_testsecret';
const PRICE_MAP = { price_growth: 'growth', price_ent: 'enterprise' };

function stripeEvent(type: string, object: Record<string, unknown>, id = 'evt_1') {
  return { id, type, created: Math.floor(Date.now() / 1000), data: { object } };
}

describe('webhook signature', () => {
  it('round-trips and rejects tampering / staleness', () => {
    const body = JSON.stringify({ hello: 'world' });
    const ts = Math.floor(Date.now() / 1000);
    const header = signBillingPayload(SECRET, ts, body);
    expect(verifyBillingSignature(SECRET, header, body)).toBe(true);
    expect(verifyBillingSignature(SECRET, header, body + ' ')).toBe(false);
    expect(verifyBillingSignature('whsec_other', header, body)).toBe(false);
    const stale = signBillingPayload(SECRET, ts - 4000, body);
    expect(verifyBillingSignature(SECRET, stale, body)).toBe(false);
    expect(verifyBillingSignature(SECRET, 'garbage', body)).toBe(false);
  });
  it('generates a prefixed secret', () => {
    expect(generateBillingWebhookSecret().secret.startsWith('whsec_')).toBe(true);
  });
});

describe('normalizeBillingEvent', () => {
  it('maps a checkout.session.completed', () => {
    const n = normalizeBillingEvent(
      stripeEvent('checkout.session.completed', {
        id: 'cs_1',
        client_reference_id: 'org-123',
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: { trace_plan: 'growth' },
      }),
    );
    expect(n).toMatchObject({
      type: 'checkout.completed',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      clientReferenceId: 'org-123',
      requestedPlanKey: 'growth',
    });
  });
  it('maps a subscription update with a price and status', () => {
    const n = normalizeBillingEvent(
      stripeEvent('customer.subscription.updated', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_ent' } }] },
      }),
    );
    expect(n).toMatchObject({
      type: 'subscription.updated',
      priceId: 'price_ent',
      subscriptionId: 'sub_1',
      providerStatus: 'active',
    });
  });
  it('maps a deletion and a failed invoice, and rejects junk', () => {
    expect(normalizeBillingEvent(stripeEvent('customer.subscription.deleted', { id: 'sub_1' }))?.type).toBe(
      'subscription.canceled',
    );
    expect(
      normalizeBillingEvent(stripeEvent('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_1' }))
        ?.type,
    ).toBe('payment.failed');
    expect(normalizeBillingEvent({ id: 'evt_x', type: 'x' })).toBeNull();
    expect(normalizeBillingEvent('nope')).toBeNull();
  });
});

describe('plan resolution', () => {
  it('maps price ↔ plan both ways', () => {
    expect(resolvePlanForPrice('price_growth', PRICE_MAP)).toBe('growth');
    expect(resolvePlanForPrice('price_unknown', PRICE_MAP)).toBeNull();
    expect(resolvePlanForPrice('price_growth', { price_growth: 'not_a_plan' })).toBeNull();
    expect(priceForPlan('enterprise', PRICE_MAP)).toBe('price_ent');
    expect(priceForPlan('free', PRICE_MAP)).toBeNull();
  });
  it('flags unknown plan keys in a map', () => {
    expect(invalidPlanKeysInMap({ p1: 'growth', p2: 'bogus', p3: 'bogus' })).toEqual(['bogus']);
  });
});

describe('billingEventOutcome', () => {
  it('checkout with an explicit plan → set it active', () => {
    const e = normalizeBillingEvent(
      stripeEvent('checkout.session.completed', { id: 'cs_1', metadata: { trace_plan: 'enterprise' } }),
    )!;
    expect(billingEventOutcome(e, PRICE_MAP)).toMatchObject({ planKey: 'enterprise', status: 'active' });
  });
  it('checkout with no plan hint → active, no plan change yet', () => {
    const e = normalizeBillingEvent(stripeEvent('checkout.session.completed', { id: 'cs_1' }))!;
    expect(billingEventOutcome(e, PRICE_MAP)).toMatchObject({ planKey: null, status: 'active' });
  });
  it('subscription update → mapped plan + provider status', () => {
    const e = normalizeBillingEvent(
      stripeEvent('customer.subscription.updated', {
        id: 'sub_1',
        status: 'past_due',
        items: { data: [{ price: { id: 'price_growth' } }] },
      }),
    )!;
    expect(billingEventOutcome(e, PRICE_MAP)).toMatchObject({ planKey: 'growth', status: 'past_due' });
  });
  it('canceled subscription → fall back to free', () => {
    const e = normalizeBillingEvent(stripeEvent('customer.subscription.deleted', { id: 'sub_1' }))!;
    expect(billingEventOutcome(e, PRICE_MAP)).toMatchObject({ planKey: 'free', status: 'canceled' });
  });
  it('payment failure → past_due, no plan change', () => {
    const e = normalizeBillingEvent(stripeEvent('invoice.payment_failed', { customer: 'cus_1' }))!;
    expect(billingEventOutcome(e, PRICE_MAP)).toMatchObject({ planKey: null, status: 'past_due' });
  });
});
