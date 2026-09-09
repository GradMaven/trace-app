'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

interface SupplierRow {
  supplierId: string;
  name: string;
  emissionsTco2e: number | null;
  methodology: string | null;
  carbonIntensityPerKEur: number | null;
}

interface Line {
  supplierId: string;
  supplierName: string;
  label: string;
  activityValue: number;
  activityUnit: string;
  factorValue: number;
  factorNumeratorUnit: string;
  factorDenominatorUnit: string;
  gwpSet: string;
  methodology: string;
}

interface LineEdit {
  reducePct: number;
  factorValue: string;
  drop: boolean;
}

interface ScenarioResult {
  baselineTco2e: string;
  projectedTco2e: string;
  deltaTco2e: string;
  deltaPct: string;
  lines: Array<{
    supplierName: string;
    label: string;
    baselineTco2e: string;
    projectedTco2e: string;
    deltaTco2e: string;
    note: string;
  }>;
}

export function ScenarioBuilder() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<Line[]>([]);
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [name, setName] = useState('Supplier switch scenario');
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState<null | 'lines' | 'run'>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void clientFetch<{ rows: SupplierRow[] }>('/procurement/suppliers').then((res) => {
      if (res.ok && res.data) setSuppliers(res.data.rows.filter((r) => r.emissionsTco2e != null));
    });
  }, []);

  const changes = useMemo(
    () =>
      lines
        .map((l) => {
          const e = edits[l.supplierId] ?? { reducePct: 0, factorValue: '', drop: false };
          if (e.drop) return { supplierId: l.supplierId, drop: true };
          const change: Record<string, unknown> = { supplierId: l.supplierId };
          if (e.reducePct > 0) change.activityMultiplier = Math.max(0, 1 - e.reducePct / 100);
          if (e.factorValue.trim() && Number(e.factorValue) !== l.factorValue) {
            change.factorValue = Number(e.factorValue);
          }
          return Object.keys(change).length > 1 ? change : null;
        })
        .filter((c): c is Record<string, unknown> => c !== null),
    [lines, edits],
  );

  async function buildLines() {
    setBusy('lines');
    setErr(null);
    setResult(null);
    const res = await clientFetch<Line[]>('/procurement/scenarios/lines', {
      method: 'POST',
      body: JSON.stringify({ supplierIds: [...selected] }),
    });
    setBusy(null);
    if (res.ok && res.data) {
      setLines(res.data);
      setEdits(
        Object.fromEntries(
          res.data.map((l) => [l.supplierId, { reducePct: 0, factorValue: '', drop: false }]),
        ),
      );
      if (res.data.length === 0)
        setErr('None of the selected suppliers have a calculation to model.');
    } else setErr(res.error?.message ?? 'Failed to build lines.');
  }

  async function run() {
    setBusy('run');
    setErr(null);
    const res = await clientFetch<{ id: string; result: ScenarioResult }>(
      '/procurement/scenarios',
      {
        method: 'POST',
        body: JSON.stringify({ name, lines, changes }),
      },
    );
    setBusy(null);
    if (res.ok && res.data) {
      setResult(res.data.result);
      router.refresh();
      router.push(`/supply-chain/carbon-map/scenarios/${res.data.id}`);
    } else setErr(res.error?.message ?? 'Failed to run the scenario.');
  }

  return (
    <section className="card" style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>New what-if scenario</h2>

      {lines.length === 0 ? (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Pick the suppliers to model. Lines start from each supplier&apos;s current attributed
            calculation.
          </p>
          <div style={{ display: 'grid', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {suppliers.map((s) => (
              <label
                key={s.supplierId}
                style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.supplierId)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.supplierId);
                    else next.delete(s.supplierId);
                    setSelected(next);
                  }}
                />
                {s.name}{' '}
                <span className="muted">
                  — {s.emissionsTco2e?.toLocaleString('en-US')} tCO2e · {s.methodology ?? 'n/a'}
                </span>
              </label>
            ))}
            {suppliers.length === 0 && (
              <span className="muted">No suppliers with attributed emissions.</span>
            )}
          </div>
          <button
            className="btn"
            disabled={busy !== null || selected.size === 0}
            onClick={() => void buildLines()}
          >
            {busy === 'lines' ? 'Loading…' : `Build ${selected.size} line(s)`}
          </button>
        </>
      ) : (
        <>
          <label style={{ fontSize: 13 }}>
            Name{' '}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                padding: 6,
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
                minWidth: 260,
              }}
            />
          </label>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Current</th>
                  <th>Reduce volume %</th>
                  <th>New factor value</th>
                  <th>Drop</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const e = edits[l.supplierId]!;
                  return (
                    <tr key={l.supplierId}>
                      <td>
                        {l.supplierName}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {l.label}
                        </div>
                      </td>
                      <td className="mono muted" style={{ fontSize: 12 }}>
                        {l.activityValue.toLocaleString('en-US')} {l.activityUnit} × {l.factorValue}{' '}
                        {l.factorNumeratorUnit}/{l.factorDenominatorUnit}
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={e.drop ? '' : e.reducePct}
                          disabled={e.drop}
                          onChange={(ev) =>
                            setEdits({
                              ...edits,
                              [l.supplierId]: { ...e, reducePct: Number(ev.target.value) || 0 },
                            })
                          }
                          style={{ width: 70, padding: 4 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min={0}
                          placeholder={String(l.factorValue)}
                          value={e.drop ? '' : e.factorValue}
                          disabled={e.drop}
                          onChange={(ev) =>
                            setEdits({
                              ...edits,
                              [l.supplierId]: { ...e, factorValue: ev.target.value },
                            })
                          }
                          style={{ width: 90, padding: 4 }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={e.drop}
                          onChange={(ev) =>
                            setEdits({
                              ...edits,
                              [l.supplierId]: { ...e, drop: ev.target.checked },
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => void run()}>
              {busy === 'run' ? 'Projecting…' : 'Project & save'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setLines([]);
                setResult(null);
              }}
            >
              Start over
            </button>
          </div>
        </>
      )}

      {err && <p style={{ color: 'var(--critical)', margin: 0 }}>{err}</p>}

      {result && (
        <div className="card">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span>
              Baseline <strong>{Number(result.baselineTco2e).toLocaleString('en-US')}</strong> tCO2e
            </span>
            <span>
              → Projected <strong>{Number(result.projectedTco2e).toLocaleString('en-US')}</strong>{' '}
              tCO2e
            </span>
            <span
              style={{
                color: Number(result.deltaTco2e) < 0 ? 'var(--positive)' : 'var(--critical)',
                fontWeight: 600,
              }}
            >
              {Number(result.deltaTco2e) > 0 ? '+' : ''}
              {Number(result.deltaTco2e).toLocaleString('en-US')} tCO2e ({result.deltaPct}%)
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
