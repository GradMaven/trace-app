'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { CurrentUsage, EvaluatedMetric, PlanTier } from './page';

const STATE_COLOR: Record<string, string> = {
  ok: 'var(--positive)',
  warn: 'var(--warning, #b7791f)',
  over: 'var(--critical)',
};

function MetricBar({ m }: { m: EvaluatedMetric }) {
  const pct = m.pct == null ? 0 : Math.min(m.pct, 100);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span>{m.label}</span>
        <span className="muted">
          {m.used.toLocaleString()}
          {m.quota != null ? ` / ${m.quota.toLocaleString()}` : ' · unlimited'}
          {m.pct != null && (
            <strong style={{ color: STATE_COLOR[m.state], marginLeft: 6 }}>{m.pct}%</strong>
          )}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: STATE_COLOR[m.state],
            transition: 'width .2s',
          }}
        />
      </div>
    </div>
  );
}

export function UsageClient({ usage, plans }: { usage: CurrentUsage; plans: PlanTier[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function changePlan(planKey: string) {
    if (planKey === usage.plan.key) return;
    if (!confirm(`Switch this organization to the ${planKey} plan?`)) return;
    setBusy(true);
    setErr(null);
    const res = await clientFetch('/usage/plan', {
      method: 'PUT',
      body: JSON.stringify({ planKey }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not change the plan.');
  }

  const anyOver = usage.metrics.some((m) => m.state === 'over');
  const anyWarn = usage.metrics.some((m) => m.state === 'warn');

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>
            {usage.plan.name} plan · {usage.period}
          </h2>
          <span
            className="tag"
            style={{
              color: anyOver ? 'var(--critical)' : anyWarn ? STATE_COLOR.warn : 'var(--positive)',
            }}
          >
            {anyOver ? 'over quota' : anyWarn ? 'nearing limit' : 'within limits'}
          </span>
        </div>
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {usage.metrics.map((m) => (
            <MetricBar key={m.metric} m={m} />
          ))}
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Plan</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          No payment integration — an operator sets the plan. Quotas apply from the next request.
        </p>
        {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
        <div style={{ display: 'grid', gap: 10 }}>
          {plans.map((p) => {
            const current = p.key === usage.plan.key;
            return (
              <div
                key={p.key}
                className="card"
                style={{
                  borderColor: current ? 'var(--accent)' : 'var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div>
                  <strong>{p.name}</strong>{' '}
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {p.key}
                  </span>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {Object.keys(p.quotas).length === 0
                      ? 'Unlimited'
                      : Object.entries(p.quotas)
                          .map(([k, v]) => `${k} ${v.toLocaleString()}`)
                          .join(' · ')}
                  </div>
                </div>
                {current ? (
                  <span className="tag" style={{ color: 'var(--accent)' }}>
                    current
                  </span>
                ) : (
                  <button className="btn" disabled={busy} onClick={() => void changePlan(p.key)}>
                    Switch
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
