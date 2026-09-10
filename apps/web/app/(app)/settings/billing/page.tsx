import { serverFetch } from '@/lib/server-api';
import { BillingClient } from './billing-client';

export const dynamic = 'force-dynamic';

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
export interface PlanTier {
  key: string;
  name: string;
  quotas: Record<string, number>;
  softWarnPct: number;
  isDefault?: boolean;
}
interface BillingResponse {
  config: BillingConfigView | null;
  subscription: { planKey: string; status: string; currentPeriod: string; startedAt: string };
  recentEvents: Array<{
    providerEventId: string;
    type: string;
    status: string;
    receivedAt: string;
  }>;
  plans: PlanTier[];
  webhookUrl: string;
}

export default async function BillingPage() {
  const res = await serverFetch<BillingResponse>('/settings/billing');

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 900 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Billing</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Connect a payment provider (Stripe-shaped). Buyers check out on the provider&apos;s
          hosted page; signed webhooks move the workspace between the Phase-13c plan tiers.
          The checkout redirect and real charges happen at the provider — TRACE only verifies
          the signature and applies the plan change.
        </p>
      </div>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      {res.data && <BillingClient data={res.data} />}
    </div>
  );
}
