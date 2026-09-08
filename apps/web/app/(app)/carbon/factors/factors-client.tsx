'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

const SCOPES = ['scope_1', 'scope_2_location', 'scope_2_market', 'scope_3'];
const CATEGORIES = [
  '',
  'cat_1_purchased_goods_services',
  'cat_4_upstream_transportation',
  'cat_6_business_travel',
  'cat_7_employee_commuting',
  'cat_9_downstream_transportation',
];
const METHODS = [
  '',
  'supplier_specific',
  'average_data',
  'spend_based',
  'distance_based',
  'fuel_based',
  'energy_based',
  'hybrid',
];

export function AddFactor() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    source: 'CUSTOM',
    sourceRef: '',
    name: '',
    value: '',
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'kg',
    scope: 'scope_3',
    ghgCategory: 'cat_1_purchased_goods_services',
    geography: '',
    methodology: 'supplier_specific',
    validFrom: '2025-01-01',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      source: form.source,
      sourceRef: form.sourceRef,
      name: form.name,
      value: Number(form.value),
      numeratorUnit: form.numeratorUnit,
      denominatorUnit: form.denominatorUnit,
      scope: form.scope,
      validFrom: form.validFrom,
    };
    if (form.ghgCategory) body.ghgCategory = form.ghgCategory;
    if (form.geography) body.geography = form.geography;
    if (form.methodology) body.methodology = form.methodology;
    const res = await clientFetch('/emission-factors', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(res.error?.message ?? 'Could not create factor.');
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Add factor
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
        paddingTop: '6vh',
        zIndex: 50,
      }}
      onClick={() => setOpen(false)}
    >
      <form
        className="card"
        style={{ width: 560, maxWidth: '92vw' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Add organization emission factor</h2>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Reference key</label>
            <input
              className="input"
              required
              value={form.sourceRef}
              onChange={(e) => set('sourceRef', e.target.value)}
              placeholder="supplier-x-steel-2025"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Valid from</label>
            <input
              className="input"
              type="date"
              value={form.validFrom}
              onChange={(e) => set('validFrom', e.target.value)}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Value</label>
            <input
              className="input"
              type="number"
              step="any"
              required
              value={form.value}
              onChange={(e) => set('value', e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Emission unit</label>
            <select
              className="input"
              value={form.numeratorUnit}
              onChange={(e) => set('numeratorUnit', e.target.value)}
            >
              {['gCO2e', 'kgCO2e', 'tCO2e', 'ktCO2e'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Per unit</label>
            <input
              className="input"
              required
              value={form.denominatorUnit}
              onChange={(e) => set('denominatorUnit', e.target.value)}
              placeholder="kg, kWh, t.km, EUR…"
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Scope</label>
            <select className="input" value={form.scope} onChange={(e) => set('scope', e.target.value)}>
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Scope 3 category</label>
            <select
              className="input"
              value={form.ghgCategory}
              onChange={(e) => set('ghgCategory', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c ? c.replace(/^cat_(\d+)_/, '$1 · ').replace(/_/g, ' ') : '— none —'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Geography (ISO)</label>
            <input
              className="input"
              value={form.geography}
              onChange={(e) => set('geography', e.target.value.toUpperCase())}
              placeholder="DE"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Methodology</label>
            <select
              className="input"
              value={form.methodology}
              onChange={(e) => set('methodology', e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m ? m.replace(/_/g, ' ') : '— none —'}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
