import { serverFetch } from '@/lib/server-api';
import { UsageClient } from './usage-client';

export const dynamic = 'force-dynamic';

export interface EvaluatedMetric {
  metric: string;
  label: string;
  kind: 'counter' | 'gauge';
  used: number;
  quota: number | null;
  pct: number | null;
  state: 'ok' | 'warn' | 'over';
}
export interface CurrentUsage {
  subscription: { organizationId: string; planKey: string; status: string; currentPeriod: string };
  plan: { key: string; name: string; quotas: Record<string, number>; softWarnPct: number };
  period: string;
  metrics: EvaluatedMetric[];
}
export interface PlanTier {
  key: string;
  name: string;
  quotas: Record<string, number>;
  softWarnPct: number;
}

export default async function UsagePage() {
  const [usageRes, plansRes] = await Promise.all([
    serverFetch<CurrentUsage>('/usage'),
    serverFetch<PlanTier[]>('/usage/plans'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 820 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Usage &amp; Plan</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          What this organization has consumed this billing period, against the plan quota. The three
          enforced metrics (AI jobs, calculation runs, exports) return{' '}
          <span className="mono">429</span> once the quota is reached.
        </p>
      </div>
      {usageRes.error && <p style={{ color: 'var(--critical)' }}>{usageRes.error.message}</p>}
      {usageRes.data && <UsageClient usage={usageRes.data} plans={plansRes.data ?? []} />}
    </div>
  );
}
