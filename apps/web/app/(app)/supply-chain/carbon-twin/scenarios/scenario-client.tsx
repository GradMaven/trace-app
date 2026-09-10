'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { SavedScenario } from './page';

interface NodeOpt {
  id: string;
  label: string;
  kind: string;
  tier: number | null;
  directTco2e: number;
  totalTco2e: number;
}
interface EdgeOpt {
  from: string;
  to: string;
}

const KINDS = ['decarbonize', 'substitute', 'drop_node', 'reroute'] as const;
type Kind = (typeof KINDS)[number];

interface Intervention {
  id: string;
  kind: Kind;
  nodeId?: string;
  reductionPct?: number;
  newDirectTco2e?: number;
  fromNodeId?: string;
  currentToNodeId?: string;
  newToNodeId?: string;
  label?: string;
}

interface Result {
  engineVersion: string;
  baseline: { totalTco2e: number; hotspotCount: number };
  projected: { totalTco2e: number; hotspotCount: number };
  deltaTco2e: number;
  deltaPct: number | null;
  nodeDeltas: Array<{
    id: string;
    label: string;
    tier: number | null;
    baselineTotalTco2e: number;
    projectedTotalTco2e: number;
    deltaTco2e: number;
    deltaPct: number | null;
  }>;
  appliedInterventions: Array<{ id: string; kind: string; label: string; ok: boolean; effect: string }>;
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function NetworkScenarioBuilder({
  baseVersion,
  nodes,
  edges,
  saved,
}: {
  baseVersion: number;
  nodes: NodeOpt[];
  edges: EdgeOpt[];
  saved: SavedScenario[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Intervention[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const supplierNodes = nodes.filter((n) => n.kind === 'supplier');
  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  function addItem() {
    setItems((v) => [
      ...v,
      { id: `iv${v.length + 1}`, kind: 'decarbonize', reductionPct: 25 },
    ]);
  }
  function patch(i: number, p: Partial<Intervention>) {
    setItems((v) => v.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  }
  function remove(i: number) {
    setItems((v) => v.filter((_, idx) => idx !== i));
  }

  async function preview() {
    setBusy('preview');
    setErr(null);
    const res = await clientFetch<{ result: Result }>('/network/scenarios/preview', {
      method: 'POST',
      body: JSON.stringify({ baseGraphVersion: baseVersion, interventions: items }),
    });
    setBusy(null);
    if (res.ok && res.data) setResult(res.data.result);
    else setErr(res.error?.message ?? 'Preview failed.');
  }

  async function save() {
    setBusy('save');
    setErr(null);
    const res = await clientFetch('/network/scenarios', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        baseGraphVersion: baseVersion,
        interventions: items,
      }),
    });
    setBusy(null);
    if (res.ok) {
      setName('');
      router.refresh();
    } else setErr(res.error?.message ?? 'Save failed.');
  }

  async function load(id: string) {
    setBusy(`load:${id}`);
    const res = await clientFetch<{ result: Result; interventions: Intervention[] }>(
      `/network/scenarios/${id}`,
      { method: 'GET' },
    );
    setBusy(null);
    if (res.ok && res.data) {
      setResult(res.data.result);
      setItems(res.data.interventions ?? []);
    } else setErr(res.error?.message ?? 'Could not load the scenario.');
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="label">Interventions (base graph v{baseVersion})</div>
          <button className="btn" onClick={addItem} disabled={busy !== null}>
            Add intervention
          </button>
        </div>
        {items.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Add one or more interventions, then preview.
          </p>
        )}
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {items.map((it, i) => (
            <div
              key={it.id}
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                alignItems: 'end',
                borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                paddingTop: i > 0 ? 8 : 0,
              }}
            >
              <label style={{ fontSize: 11 }}>
                Kind
                <select
                  className="input"
                  value={it.kind}
                  onChange={(e) => patch(i, { kind: e.target.value as Kind })}
                >
                  {KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>

              {(it.kind === 'decarbonize' ||
                it.kind === 'substitute' ||
                it.kind === 'drop_node') && (
                <label style={{ fontSize: 11 }}>
                  Node
                  <select
                    className="input"
                    value={it.nodeId ?? ''}
                    onChange={(e) => patch(i, { nodeId: e.target.value })}
                  >
                    <option value="">—</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label} ({fmt(n.totalTco2e)} t)
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {it.kind === 'decarbonize' && (
                <label style={{ fontSize: 11 }}>
                  Cut %
                  <input
                    className="input"
                    style={{ width: 70 }}
                    value={it.reductionPct ?? ''}
                    onChange={(e) => patch(i, { reductionPct: Number(e.target.value) })}
                  />
                </label>
              )}
              {it.kind === 'substitute' && (
                <label style={{ fontSize: 11 }}>
                  New direct tCO2e
                  <input
                    className="input"
                    style={{ width: 110 }}
                    value={it.newDirectTco2e ?? ''}
                    onChange={(e) => patch(i, { newDirectTco2e: Number(e.target.value) })}
                  />
                </label>
              )}
              {it.kind === 'reroute' && (
                <>
                  <label style={{ fontSize: 11 }}>
                    Edge from
                    <select
                      className="input"
                      value={it.fromNodeId ?? ''}
                      onChange={(e) => patch(i, { fromNodeId: e.target.value })}
                    >
                      <option value="">—</option>
                      {[...new Set(edges.map((x) => x.from))].map((id) => (
                        <option key={id} value={id}>
                          {nodeLabel(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 11 }}>
                    currently →
                    <select
                      className="input"
                      value={it.currentToNodeId ?? ''}
                      onChange={(e) => patch(i, { currentToNodeId: e.target.value })}
                    >
                      <option value="">—</option>
                      {edges
                        .filter((x) => x.from === it.fromNodeId)
                        .map((x) => (
                          <option key={x.to} value={x.to}>
                            {nodeLabel(x.to)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 11 }}>
                    new →
                    <select
                      className="input"
                      value={it.newToNodeId ?? ''}
                      onChange={(e) => patch(i, { newToNodeId: e.target.value })}
                    >
                      <option value="">—</option>
                      {supplierNodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <button
                className="btn"
                style={{ padding: '1px 8px', fontSize: 12 }}
                onClick={() => remove(i)}
                disabled={busy !== null}
              >
                remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => void preview()}
            disabled={busy !== null || items.length === 0}
          >
            {busy === 'preview' ? 'Projecting…' : 'Preview'}
          </button>
          <label style={{ fontSize: 11 }}>
            Save as
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Scenario name"
            />
          </label>
          <button
            className="btn"
            onClick={() => void save()}
            disabled={busy !== null || items.length === 0 || !name.trim()}
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
        {err && <p style={{ color: 'var(--critical)', fontSize: 13, marginTop: 6 }}>{err}</p>}
      </section>

      {result && (
        <section className="card">
          <div className="label">Projection</div>
          <p style={{ fontSize: 15, margin: '6px 0' }}>
            baseline <strong>{fmt(result.baseline.totalTco2e)}</strong> →{' '}
            <strong>{fmt(result.projected.totalTco2e)}</strong> tCO2e ·{' '}
            <span
              style={{
                color: result.deltaTco2e < 0 ? 'var(--positive)' : 'var(--critical)',
                fontWeight: 600,
              }}
            >
              {result.deltaTco2e >= 0 ? '+' : ''}
              {fmt(result.deltaTco2e)} tCO2e
              {result.deltaPct != null ? ` (${result.deltaPct}%)` : ''}
            </span>{' '}
            · hotspots {result.baseline.hotspotCount} → {result.projected.hotspotCount}
          </p>
          <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 12 }}>
            {result.appliedInterventions.map((a) => (
              <li key={a.id} style={{ color: a.ok ? undefined : 'var(--critical)' }}>
                {a.label} — {a.effect}
                {!a.ok ? ' (skipped)' : ''}
              </li>
            ))}
          </ul>
          {result.nodeDeltas.length > 0 && (
            <table style={{ width: '100%', fontSize: 12, marginTop: 6 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th>Node</th>
                  <th style={{ textAlign: 'right' }}>baseline</th>
                  <th style={{ textAlign: 'right' }}>projected</th>
                  <th style={{ textAlign: 'right' }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {result.nodeDeltas.map((d) => (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td>{d.label}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(d.baselineTotalTco2e)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(d.projectedTotalTco2e)}</td>
                    <td
                      style={{
                        textAlign: 'right',
                        color: d.deltaTco2e < 0 ? 'var(--positive)' : 'var(--critical)',
                      }}
                    >
                      {d.deltaTco2e >= 0 ? '+' : ''}
                      {fmt(d.deltaTco2e)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {saved.length > 0 && (
        <section className="card">
          <div className="label">Saved scenarios</div>
          <table style={{ width: '100%', fontSize: 13, marginTop: 6 }}>
            <tbody>
              {saved.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 6px' }}>
                    <button
                      className="btn"
                      style={{ padding: '1px 8px', fontSize: 12 }}
                      onClick={() => void load(s.id)}
                      disabled={busy !== null}
                    >
                      {s.name}
                    </button>
                  </td>
                  <td style={{ padding: '4px 6px' }} className="muted">
                    v{s.baseGraphVersion} · {s.interventions} intervention(s)
                  </td>
                  <td
                    style={{
                      padding: '4px 6px',
                      textAlign: 'right',
                      color: Number(s.deltaTco2e) < 0 ? 'var(--positive)' : 'var(--critical)',
                    }}
                  >
                    {Number(s.deltaTco2e) >= 0 ? '+' : ''}
                    {fmt(Number(s.deltaTco2e))} tCO2e ({s.deltaPct}%)
                  </td>
                  <td style={{ padding: '4px 6px', color: 'var(--text-secondary)' }}>
                    {new Date(s.createdAt).toLocaleDateString()}
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
