'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { EdgeRow } from './page';

interface SupplierOpt {
  id: string;
  name: string;
}

interface TraceResult {
  version: number;
  node: { label: string; totalTco2e: number; directTco2e: number; attribution: string };
  pathLabels: string[];
  hops: number;
  calculations: Array<{
    id: string;
    resultTco2e: string;
    methodology: string;
    factorSource: string;
    reportingPeriod: string;
    evidenceCount: number;
  }>;
}

export function CarbonTwinTools({
  hasSnapshot,
  suppliers,
  edges,
  version,
  traceNodes = [],
}: {
  hasSnapshot: boolean;
  suppliers: SupplierOpt[];
  edges: EdgeRow[];
  version?: number;
  traceNodes?: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | string>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showEdges, setShowEdges] = useState(false);
  const [trace, setTrace] = useState<TraceResult | null>(null);

  const [from, setFrom] = useState('');
  const [toId, setToId] = useState('');
  const [toLabel, setToLabel] = useState('');
  const [rel, setRel] = useState('');

  async function compute() {
    setBusy('compute');
    setErr(null);
    const res = await clientFetch('/network/graph/compute', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setBusy(null);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Compute failed.');
  }

  async function addEdge(e: React.FormEvent) {
    e.preventDefault();
    if (!from || (!toId && !toLabel.trim())) {
      setErr('Pick a buyer supplier and either an upstream supplier or a label.');
      return;
    }
    setBusy('edge');
    setErr(null);
    const res = await clientFetch('/network/edges', {
      method: 'POST',
      body: JSON.stringify({
        fromSupplierId: from,
        toSupplierId: toId || null,
        toLabel: toLabel.trim() || null,
        relationship: rel.trim() || null,
      }),
    });
    setBusy(null);
    if (res.ok) {
      setToId('');
      setToLabel('');
      setRel('');
      router.refresh();
    } else setErr(res.error?.message ?? 'Could not add the link.');
  }

  async function removeEdge(id: string) {
    setBusy(`del:${id}`);
    const res = await clientFetch(`/network/edges/${id}`, { method: 'DELETE' });
    setBusy(null);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not remove.');
  }

  async function openTrace(nodeId: string) {
    setBusy('trace');
    const q = version ? `?version=${version}` : '';
    const res = await clientFetch<TraceResult>(
      `/network/graph/nodes/${encodeURIComponent(nodeId)}/trace${q}`,
      { method: 'GET' },
    );
    setBusy(null);
    if (res.ok && res.data) setTrace(res.data);
    else setErr(res.error?.message ?? 'Could not load the trace.');
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <button className="btn btn-primary" onClick={() => void compute()} disabled={busy !== null}>
        {busy === 'compute' ? 'Computing…' : hasSnapshot ? 'Recompute' : 'Compute graph'}
      </button>
      <button className="btn" onClick={() => setShowEdges((v) => !v)} disabled={busy !== null}>
        Upstream links ({edges.length})
      </button>
      {traceNodes.length > 0 && (
        <select
          className="input"
          style={{ maxWidth: 220 }}
          value=""
          onChange={(e) => {
            if (e.target.value) void openTrace(e.target.value);
          }}
          disabled={busy !== null}
        >
          <option value="">Trace a node…</option>
          {traceNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      )}
      {err && (
        <p style={{ color: 'var(--critical)', fontSize: 13, width: '100%', margin: '4px 0 0' }}>
          {err}
        </p>
      )}

      {showEdges && (
        <div className="card" style={{ width: '100%', marginTop: 8 }}>
          <div className="label" style={{ marginBottom: 6 }}>
            Declared upstream links
          </div>
          {edges.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              None yet. Declare which of your suppliers buy from which upstream parties to extend
              the graph beyond tier 1.
            </p>
          ) : (
            <ul style={{ margin: '0 0 10px', paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
              {edges.map((e) => (
                <li key={e.id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>
                    <strong>{e.fromSupplierName}</strong> → {e.toLabel}
                    {e.relationship ? <span className="muted"> ({e.relationship})</span> : null}
                    {e.toSupplierId ? null : <span className="muted"> · external</span>}
                  </span>
                  <button
                    className="btn"
                    style={{ padding: '1px 8px', fontSize: 12 }}
                    onClick={() => void removeEdge(e.id)}
                    disabled={busy !== null}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addEdge} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ fontSize: 12 }}>
              Buyer
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              Upstream supplier
              <select
                className="input"
                value={toId}
                onChange={(e) => {
                  setToId(e.target.value);
                  if (e.target.value) setToLabel('');
                }}
              >
                <option value="">— (or type a name)</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              …or label
              <input
                className="input"
                value={toLabel}
                onChange={(e) => setToLabel(e.target.value)}
                placeholder="e.g. Iron ore mine"
                disabled={Boolean(toId)}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Relationship
              <input
                className="input"
                value={rel}
                onChange={(e) => setRel(e.target.value)}
                placeholder="raw material"
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy !== null}>
              Add
            </button>
          </form>
        </div>
      )}

      {trace && (
        <div
          className="card"
          style={{ width: '100%', marginTop: 8, position: 'relative' }}
          role="dialog"
        >
          <button
            className="btn"
            style={{ position: 'absolute', top: 10, right: 10, padding: '1px 8px' }}
            onClick={() => setTrace(null)}
          >
            close
          </button>
          <div className="label">Trace — {trace.node.label}</div>
          <p style={{ fontSize: 13, margin: '6px 0' }}>
            Path from the root ({trace.hops} hop{trace.hops === 1 ? '' : 's'}):{' '}
            <span className="mono">{trace.pathLabels.join('  →  ')}</span>
          </p>
          <p style={{ fontSize: 13, margin: '6px 0' }}>
            direct <strong>{trace.node.directTco2e}</strong> tCO2e ·  total{' '}
            <strong>{trace.node.totalTco2e}</strong> tCO2e · attribution {trace.node.attribution}
          </p>
          {trace.calculations.length > 0 ? (
            <table style={{ width: '100%', fontSize: 12, marginTop: 6 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th>tCO2e</th>
                  <th>methodology</th>
                  <th>factor source</th>
                  <th>period</th>
                  <th>evidence</th>
                </tr>
              </thead>
              <tbody>
                {trace.calculations.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td>{c.resultTco2e}</td>
                    <td>{c.methodology}</td>
                    <td>{c.factorSource}</td>
                    <td>{c.reportingPeriod}</td>
                    <td>{c.evidenceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>
              No backing calculations for this node in the snapshot period.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
