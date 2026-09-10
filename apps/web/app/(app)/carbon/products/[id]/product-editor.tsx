'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { BomLineView, FactorOpt, Named, ProductDetail } from './page';

const KINDS = ['material', 'energy', 'transport', 'component', 'process', 'packaging'] as const;
const SOURCES = ['factor', 'supplier', 'sub_product', 'manual'] as const;
const TIERS = ['primary', 'secondary', 'estimated'] as const;
const ALLOC = ['none', 'mass', 'economic', 'physical'] as const;

const RATING_COLOR: Record<string, string> = {
  A: 'var(--positive)',
  B: 'var(--positive)',
  C: 'var(--attention, orange)',
  D: 'var(--critical)',
  E: 'var(--critical)',
};

interface LineDraft {
  label: string;
  kind: string;
  quantity: string;
  unit: string;
  source: string;
  emissionFactorId: string;
  supplierId: string;
  subProductId: string;
  manualKgCo2e: string;
  dataTier: string;
  note: string;
}

function emptyDraft(): LineDraft {
  return {
    label: '',
    kind: 'material',
    quantity: '1',
    unit: 'kg',
    source: 'factor',
    emissionFactorId: '',
    supplierId: '',
    subProductId: '',
    manualKgCo2e: '',
    dataTier: 'secondary',
    note: '',
  };
}
function draftFromLine(l: BomLineView): LineDraft {
  return {
    label: l.label,
    kind: l.kind,
    quantity: l.quantity,
    unit: l.unit,
    source: l.source,
    emissionFactorId: l.emissionFactorId ?? '',
    supplierId: l.supplierId ?? '',
    subProductId: l.subProductId ?? '',
    manualKgCo2e: l.manualKgCo2e ?? '',
    dataTier: l.dataTier,
    note: l.note ?? '',
  };
}
function draftToBody(d: LineDraft) {
  return {
    label: d.label.trim(),
    kind: d.kind,
    quantity: Number(d.quantity),
    unit: d.unit.trim(),
    source: d.source,
    emissionFactorId: d.source === 'factor' ? d.emissionFactorId || null : null,
    supplierId: d.source === 'supplier' ? d.supplierId || null : null,
    subProductId: d.source === 'sub_product' ? d.subProductId || null : null,
    manualKgCo2e: d.source === 'manual' ? Number(d.manualKgCo2e) : null,
    dataTier: d.dataTier,
    note: d.note.trim() || null,
  };
}

export function ProductEditor({
  product,
  factors,
  suppliers,
  products,
  history,
}: {
  product: ProductDetail;
  factors: FactorOpt[];
  suppliers: Named[];
  products: Named[];
  history: Array<{
    version: number;
    totalKgCo2e: string;
    dataQualityRating: string;
    primaryDataSharePct: number;
    methodVersion: string;
    computedAt: string;
  }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<LineDraft>(emptyDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<LineDraft>(emptyDraft());
  const [allocMethod, setAllocMethod] = useState(product.allocationMethod);
  const [allocFactor, setAllocFactor] = useState(String(product.allocationFactor));

  async function api(path: string, method: string, body?: unknown) {
    setErr(null);
    const res = await clientFetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) setErr(res.error?.message ?? 'Request failed.');
    return res.ok;
  }

  async function saveAllocation() {
    setBusy('alloc');
    const ok = await api(`/products/${product.id}`, 'PATCH', {
      allocationMethod: allocMethod,
      allocationFactor: Number(allocFactor),
    });
    setBusy(null);
    if (ok) router.refresh();
  }
  async function addLine() {
    setBusy('add');
    const ok = await api(`/products/${product.id}/bom`, 'POST', draftToBody(draft));
    setBusy(null);
    if (ok) {
      setAdding(false);
      setDraft(emptyDraft());
      router.refresh();
    }
  }
  async function saveEdit() {
    if (!editId) return;
    setBusy('edit');
    const ok = await api(`/products/${product.id}/bom/${editId}`, 'PATCH', draftToBody(editDraft));
    setBusy(null);
    if (ok) {
      setEditId(null);
      router.refresh();
    }
  }
  async function removeLine(lineId: string) {
    setBusy(`del:${lineId}`);
    const ok = await api(`/products/${product.id}/bom/${lineId}`, 'DELETE');
    setBusy(null);
    if (ok) router.refresh();
  }
  async function compute() {
    setBusy('compute');
    const ok = await api(`/products/${product.id}/pcf/compute`, 'POST', {});
    setBusy(null);
    if (ok) router.refresh();
  }

  const pcf = product.latestPcf;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}

      <section className="card">
        <div className="label">Product</div>
        <p style={{ margin: '4px 0', fontSize: 14 }}>
          Functional unit <strong>{product.functionalUnit}</strong> · boundary{' '}
          <span className="mono">{product.boundary}</span>
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>
            Allocation method
            <select
              className="input"
              value={allocMethod}
              onChange={(e) => setAllocMethod(e.target.value)}
            >
              {ALLOC.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Factor (0–1)
            <input
              className="input"
              style={{ width: 90 }}
              value={allocFactor}
              onChange={(e) => setAllocFactor(e.target.value)}
            />
          </label>
          <button className="btn" onClick={() => void saveAllocation()} disabled={busy !== null}>
            {busy === 'alloc' ? '…' : 'Save allocation'}
          </button>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between' }}>
          <strong>Bill of materials</strong>
          <button className="btn" onClick={() => setAdding((v) => !v)} disabled={busy !== null}>
            {adding ? 'Cancel' : 'Add line'}
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Line</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th>Unit</th>
              <th>Source</th>
              <th>Tier</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <LineForm
                draft={draft}
                setDraft={setDraft}
                factors={factors}
                suppliers={suppliers}
                products={products}
                onSubmit={() => void addLine()}
                busy={busy !== null}
                submitLabel="Add"
              />
            )}
            {product.bomLines.map((l) =>
              editId === l.id ? (
                <LineForm
                  key={l.id}
                  draft={editDraft}
                  setDraft={setEditDraft}
                  factors={factors}
                  suppliers={suppliers}
                  products={products}
                  onSubmit={() => void saveEdit()}
                  busy={busy !== null}
                  submitLabel="Save"
                />
              ) : (
                <tr key={l.id}>
                  <td>
                    {l.label}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {l.kind}
                      {l.emissionFactorLabel ? ` · ${l.emissionFactorLabel}` : ''}
                      {l.supplierName ? ` · ${l.supplierName}` : ''}
                      {l.subProductName ? ` · PCF: ${l.subProductName}` : ''}
                      {l.manualKgCo2e ? ` · ${l.manualKgCo2e} kg/unit` : ''}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }} className="mono">
                    {l.quantity}
                  </td>
                  <td className="muted">{l.unit}</td>
                  <td className="muted">{l.source}</td>
                  <td className="muted">{l.dataTier}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn"
                      style={{ padding: '1px 8px', fontSize: 12 }}
                      onClick={() => {
                        setEditId(l.id);
                        setEditDraft(draftFromLine(l));
                      }}
                      disabled={busy !== null}
                    >
                      edit
                    </button>{' '}
                    <button
                      className="btn"
                      style={{ padding: '1px 8px', fontSize: 12 }}
                      onClick={() => void removeLine(l.id)}
                      disabled={busy !== null}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ),
            )}
            {product.bomLines.length === 0 && !adding && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 14 }}>
                  No lines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div>
        <button
          className="btn btn-primary"
          onClick={() => void compute()}
          disabled={busy !== null || product.bomLines.length === 0}
        >
          {busy === 'compute' ? 'Computing…' : 'Compute PCF'}
        </button>
      </div>

      {pcf && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="label">
              PCF v{pcf.version} · {pcf.methodVersion}
            </div>
            <span
              className="tag"
              style={{
                color: RATING_COLOR[pcf.dataQualityRating],
                borderColor: RATING_COLOR[pcf.dataQualityRating],
              }}
            >
              rating {pcf.dataQualityRating}
            </span>
          </div>
          <p style={{ fontSize: 22, fontWeight: 700, margin: '8px 0 2px' }}>
            {Number(pcf.totalKgCo2e).toLocaleString('en-US', { maximumFractionDigits: 3 })} kg CO2e
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {' '}
              / {pcf.functionalUnit}
            </span>
          </p>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            subtotal {Number(pcf.subtotalKgCo2e).toLocaleString('en-US', { maximumFractionDigits: 3 })}{' '}
            kg × allocation {pcf.allocationFactor} ({pcf.allocationMethod}) · primary data{' '}
            {pcf.footprint.primaryDataSharePct}% · secondary {pcf.footprint.secondaryDataSharePct}% ·
            estimated {pcf.footprint.estimatedDataSharePct}%
          </p>

          {pcf.footprint.warnings.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--critical)' }}>
              {pcf.footprint.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 12 }}>
            <div className="label" style={{ marginBottom: 6 }}>
              By kind
            </div>
            <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {pcf.footprint.byKind.map((k) => (
                <span
                  key={k.kind}
                  title={`${k.kind} — ${k.kgCo2e} kg (${k.sharePct}%)`}
                  style={{
                    width: `${k.sharePct}%`,
                    background: 'var(--accent)',
                    borderRight: '1px solid var(--bg)',
                  }}
                />
              ))}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {pcf.footprint.byKind.map((k) => `${k.kind} ${k.sharePct}%`).join(' · ')}
            </div>
          </div>

          <table style={{ width: '100%', fontSize: 12, marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                <th>Line</th>
                <th style={{ textAlign: 'right' }}>kg CO2e</th>
                <th style={{ textAlign: 'right' }}>share</th>
                <th>tier</th>
                <th>resolved from</th>
              </tr>
            </thead>
            <tbody>
              {pcf.footprint.breakdown.map((b) => (
                <tr key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td>
                    {b.label}
                    {b.warning && <span style={{ color: 'var(--critical)' }}> ⚠</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {b.kgCo2e.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                  </td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    {b.sharePct}%
                  </td>
                  <td className="muted">{b.dataTier}</td>
                  <td className="muted">{b.resolvedFrom}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mono muted" style={{ fontSize: 10, marginTop: 8, wordBreak: 'break-all' }}>
            digest {pcf.inputsDigest}
          </p>
        </section>
      )}

      {history.length > 1 && (
        <section className="card">
          <div className="label">Version history</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
            {history.map((h) => (
              <li key={h.version}>
                v{h.version} — {Number(h.totalKgCo2e).toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
                kg · rating {h.dataQualityRating} · primary {h.primaryDataSharePct}% ·{' '}
                {new Date(h.computedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LineForm({
  draft,
  setDraft,
  factors,
  suppliers,
  products,
  onSubmit,
  busy,
  submitLabel,
}: {
  draft: LineDraft;
  setDraft: (d: LineDraft) => void;
  factors: FactorOpt[];
  suppliers: Named[];
  products: Named[];
  onSubmit: () => void;
  busy: boolean;
  submitLabel: string;
}) {
  const set = (patch: Partial<LineDraft>) => setDraft({ ...draft, ...patch });
  return (
    <tr>
      <td colSpan={6} style={{ background: 'var(--surface-sunken)' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'end', padding: '6px 0' }}>
          <label style={{ fontSize: 11 }}>
            Label
            <input className="input" value={draft.label} onChange={(e) => set({ label: e.target.value })} />
          </label>
          <label style={{ fontSize: 11 }}>
            Kind
            <select className="input" value={draft.kind} onChange={(e) => set({ kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 11 }}>
            Qty
            <input
              className="input"
              style={{ width: 80 }}
              value={draft.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 11 }}>
            Unit
            <input
              className="input"
              style={{ width: 70 }}
              value={draft.unit}
              onChange={(e) => set({ unit: e.target.value })}
            />
          </label>
          <label style={{ fontSize: 11 }}>
            Source
            <select
              className="input"
              value={draft.source}
              onChange={(e) => set({ source: e.target.value })}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {draft.source === 'factor' && (
            <label style={{ fontSize: 11 }}>
              Factor
              <select
                className="input"
                value={draft.emissionFactorId}
                onChange={(e) => set({ emissionFactorId: e.target.value })}
              >
                <option value="">—</option>
                {factors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.denominatorUnit})
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.source === 'supplier' && (
            <label style={{ fontSize: 11 }}>
              Supplier
              <select
                className="input"
                value={draft.supplierId}
                onChange={(e) => set({ supplierId: e.target.value })}
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.source === 'sub_product' && (
            <label style={{ fontSize: 11 }}>
              Sub-product
              <select
                className="input"
                value={draft.subProductId}
                onChange={(e) => set({ subProductId: e.target.value })}
              >
                <option value="">—</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.source === 'manual' && (
            <label style={{ fontSize: 11 }}>
              kg CO2e / unit
              <input
                className="input"
                style={{ width: 100 }}
                value={draft.manualKgCo2e}
                onChange={(e) => set({ manualKgCo2e: e.target.value })}
              />
            </label>
          )}
          <label style={{ fontSize: 11 }}>
            Tier
            <select
              className="input"
              value={draft.dataTier}
              onChange={(e) => set({ dataTier: e.target.value })}
            >
              {TIERS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={onSubmit} disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </td>
    </tr>
  );
}
