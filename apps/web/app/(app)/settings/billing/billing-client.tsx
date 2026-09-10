'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { BillingConfigView, PlanTier } from './page';

interface Data {
  config: BillingConfigView | null;
  subscription: { planKey: string; status: string; currentPeriod: string; startedAt: string };
  recentEvents: Array<{ providerEventId: string; type: string; status: string; receivedAt: string }>;
  plans: PlanTier[];
  webhookUrl: string;
}

export function BillingClient({ data }: { data: Data }) {
  const router = useRouter();
  const cfg = data.config;
  const [provider, setProvider] = useState(cfg?.provider ?? 'stripe');
  const [enabled, setEnabled] = useState(cfg?.enabled ?? false);
  const [publishableKey, setPublishableKey] = useState(cfg?.publishableKey ?? '');
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [priceMapText, setPriceMapText] = useState(
    JSON.stringify(cfg?.priceToPlan ?? {}, null, 0),
  );
  const [busy, setBusy] = useState<null | string>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setErr(null);
    setNote(null);
    let priceToPlan: Record<string, string> = {};
    try {
      priceToPlan = priceMapText.trim() ? JSON.parse(priceMapText) : {};
    } catch {
      setBusy(null);
      setErr('The price → plan map must be a valid JSON object.');
      return;
    }
    const body: Record<string, unknown> = { provider, enabled, priceToPlan };
    body.publishableKey = publishableKey.trim() || null;
    if (secretKey) body.secretKey = secretKey;
    if (webhookSecret) body.webhookSecret = webhookSecret;
    const res = await clientFetch<{ webhookSecret?: string }>('/settings/billing', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (res.ok) {
      setSecretKey('');
      setWebhookSecret('');
      if (res.data?.webhookSecret) setFreshSecret(res.data.webhookSecret);
      router.refresh();
      setNote('Saved.');
    } else {
      setErr(res.error?.message ?? 'Could not save.');
    }
  }

  async function rotateSecret() {
    setBusy('rotate');
    const res = await clientFetch<{ webhookSecret: string }>('/settings/billing/webhook-secret', {
      method: 'POST',
    });
    setBusy(null);
    if (res.ok && res.data) {
      setFreshSecret(res.data.webhookSecret);
      router.refresh();
    } else setErr(res.error?.message ?? 'Could not rotate.');
  }

  async function checkout(planKey: string) {
    setBusy(`checkout:${planKey}`);
    setErr(null);
    const res = await clientFetch<{ url: string }>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planKey, returnPath: '/settings/billing' }),
    });
    setBusy(null);
    if (res.ok && res.data?.url) window.location.href = res.data.url;
    else setErr(res.error?.message ?? 'Could not start checkout.');
  }

  async function portal() {
    setBusy('portal');
    const res = await clientFetch<{ url: string }>('/billing/portal?returnPath=/settings/billing', {
      method: 'GET',
    });
    setBusy(null);
    if (res.ok && res.data?.url) window.location.href = res.data.url;
    else setErr(res.error?.message ?? 'Could not open the billing portal.');
  }

  async function remove() {
    if (!confirm('Remove the billing connection? The current plan stays as-is.')) return;
    setBusy('delete');
    const res = await clientFetch('/settings/billing', { method: 'DELETE' });
    setBusy(null);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not remove.');
  }

  const code = {
    display: 'block',
    background: 'var(--bg-subtle)',
    padding: 10,
    borderRadius: 6,
    userSelect: 'all' as const,
    wordBreak: 'break-all' as const,
    fontSize: 12,
  };
  const statusColor =
    data.subscription.status === 'active'
      ? 'var(--positive)'
      : data.subscription.status === 'past_due'
        ? 'var(--warning, orange)'
        : 'var(--text-secondary)';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card">
        <div className="label">Current subscription</div>
        <p style={{ margin: '6px 0', fontSize: 15 }}>
          <strong>{data.subscription.planKey}</strong> ·{' '}
          <span style={{ color: statusColor }}>{data.subscription.status}</span> · period{' '}
          <span className="mono">{data.subscription.currentPeriod}</span>
        </p>
        {cfg?.enabled && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {data.plans
              .filter((p) => p.key !== data.subscription.planKey && !p.isDefault)
              .map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void checkout(p.key)}
                  disabled={busy !== null}
                >
                  {busy === `checkout:${p.key}` ? '…' : `Upgrade to ${p.name}`}
                </button>
              ))}
            {cfg.customerId && (
              <button
                type="button"
                className="btn"
                onClick={() => void portal()}
                disabled={busy !== null}
              >
                {busy === 'portal' ? '…' : 'Manage billing'}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="label">Webhook endpoint (register at your provider)</div>
        <code style={code}>{data.webhookUrl}</code>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Header <span className="mono">x-trace-billing-signature</span>, scheme{' '}
          <span className="mono">t=&lt;unix&gt;,v1=&lt;hmac-sha256&gt;</span> over the raw body
          (300s tolerance).
        </p>
        {freshSecret && (
          <>
            <code style={{ ...code, color: 'var(--positive)', marginTop: 8 }}>{freshSecret}</code>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Copy this signing secret now — it is shown once.
            </p>
          </>
        )}
        {cfg && (
          <button
            type="button"
            className="btn"
            onClick={() => void rotateSecret()}
            disabled={busy !== null}
            style={{ marginTop: 8 }}
          >
            {busy === 'rotate'
              ? 'Issuing…'
              : cfg.hasWebhookSecret
                ? 'Rotate signing secret'
                : 'Issue signing secret'}
          </button>
        )}
      </section>

      <form className="card" onSubmit={save}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 12 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <strong>Enable the billing provider for this workspace</strong>
        </label>
        <div className="field">
          <label className="label">Provider</label>
          <select
            className="input"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="stripe">Stripe</option>
            <option value="test">Test (no network)</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Publishable key</label>
          <input
            className="input mono"
            value={publishableKey}
            onChange={(e) => setPublishableKey(e.target.value)}
            placeholder="pk_live_…"
          />
        </div>
        <div className="field">
          <label className="label">
            Secret key {cfg?.hasSecretKey && <span className="muted">(leave blank to keep)</span>}
          </label>
          <input
            className="input mono"
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="sk_live_…"
          />
        </div>
        <div className="field">
          <label className="label">
            Webhook signing secret{' '}
            {cfg?.hasWebhookSecret && <span className="muted">(leave blank to keep)</span>}
          </label>
          <input
            className="input mono"
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="whsec_…"
          />
        </div>
        <div className="field">
          <label className="label">
            Price → plan (JSON, e.g. {'{"price_123":"growth","price_456":"enterprise"}'})
          </label>
          <input
            className="input mono"
            value={priceMapText}
            onChange={(e) => setPriceMapText(e.target.value)}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Plan keys: {data.plans.map((p) => p.key).join(', ')}.
          </p>
        </div>

        {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
        {note && <p style={{ color: 'var(--positive)', fontSize: 13 }}>{note}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : cfg ? 'Save changes' : 'Configure billing'}
          </button>
          {cfg && (
            <button
              className="btn"
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
            >
              Remove connection
            </button>
          )}
        </div>
      </form>

      {data.recentEvents.length > 0 && (
        <section className="card">
          <div className="label">Recent webhook events</div>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 6 }}>
            <tbody>
              {data.recentEvents.map((ev) => (
                <tr key={ev.providerEventId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 6px' }} className="mono">
                    {ev.type}
                  </td>
                  <td style={{ padding: '4px 6px' }}>{ev.status}</td>
                  <td style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}>
                    {new Date(ev.receivedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
