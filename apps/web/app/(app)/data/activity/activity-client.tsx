'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

const SCOPES = [
  ['scope_1', 'Scope 1'],
  ['scope_2_location', 'Scope 2 (location-based)'],
  ['scope_2_market', 'Scope 2 (market-based)'],
  ['scope_3', 'Scope 3'],
] as const;

const CATEGORIES = [
  ['', '— none (Scope 1/2) —'],
  ['cat_1_purchased_goods_services', '1 · Purchased goods & services'],
  ['cat_4_upstream_transportation', '4 · Upstream transportation'],
  ['cat_6_business_travel', '6 · Business travel'],
  ['cat_7_employee_commuting', '7 · Employee commuting'],
  ['cat_9_downstream_transportation', '9 · Downstream transportation'],
] as const;

export function CreateActivity({ units }: { units: Array<{ code: string; dimension: string; label: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('scope_3');
  const [ghgCategory, setGhgCategory] = useState('cat_1_purchased_goods_services');
  const [category, setCategory] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('t');
  const [reportingPeriod, setReportingPeriod] = useState('FY2025');
  const [provenance, setProvenance] = useState('measured');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      scope,
      category,
      value: Number(value),
      unit,
      reportingPeriod,
      provenance,
      subjectType: 'organization',
      subjectId: '00000000-0000-0000-0000-000000000000',
    };
    if (scope === 'scope_3' && ghgCategory) body.ghgCategory = ghgCategory;
    // subjectId must be the org id — fetched via /me on the server; use a hidden approach:
    const me = await clientFetch<{ activeOrganizationId: string }>('/me');
    if (me.ok && me.data) body.subjectId = me.data.activeOrganizationId;
    const res = await clientFetch<{ id: string }>('/activity-data', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok && res.data) router.push(`/data/activity/${res.data.id}`);
    else setError(res.error?.message ?? 'Could not create activity data.');
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Add activity data
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '7vh',
        zIndex: 50,
      }}
      onClick={() => setOpen(false)}
    >
      <form
        className="card"
        style={{ width: 520, maxWidth: '92vw' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Add activity data</h2>
        <div className="field">
          <label className="label">Category / description</label>
          <input
            className="input"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Purchased electricity — DE sites"
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Scope</label>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
              {SCOPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {scope === 'scope_3' && (
            <div className="field" style={{ flex: 1 }}>
              <label className="label">Scope 3 category</label>
              <select
                className="input"
                value={ghgCategory}
                onChange={(e) => setGhgCategory(e.target.value)}
              >
                {CATEGORIES.filter(([v]) => v).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Quantity</label>
            <input
              className="input"
              type="number"
              step="any"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Unit</label>
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} — {u.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Period</label>
            <input
              className="input"
              value={reportingPeriod}
              onChange={(e) => setReportingPeriod(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label className="label">Provenance</label>
          <select className="input" value={provenance} onChange={(e) => setProvenance(e.target.value)}>
            {['measured', 'supplier_reported', 'estimated', 'modeled', 'inferred'].map((p) => (
              <option key={p} value={p}>
                {p.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !category || !value}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
