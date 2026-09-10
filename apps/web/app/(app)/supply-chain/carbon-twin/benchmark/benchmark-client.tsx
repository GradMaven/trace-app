'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { BenchmarkSettings, BenchmarkView, MetricComparison } from './page';

const METRIC_LABEL: Record<string, string> = {
  primary_data_share_pct: 'Primary (supplier-specific) data share',
  evidence_backed_pct: 'Evidence-backed emissions share',
  pcf_primary_data_share_pct: 'Product-footprint primary-data share',
};
const STANDING_LABEL: Record<string, { text: string; color: string }> = {
  ahead: { text: 'ahead of the median', color: 'var(--positive)' },
  in_line: { text: 'in line with peers', color: 'var(--text-secondary)' },
  behind: { text: 'behind the median', color: 'var(--critical)' },
  unknown: { text: '—', color: 'var(--text-secondary)' },
};

export function BenchmarkPanel({
  settings,
  view,
}: {
  settings: BenchmarkSettings;
  view: BenchmarkView | null;
}) {
  const router = useRouter();
  const [sector, setSector] = useState(settings.sector ?? '');
  const [optIn, setOptIn] = useState(settings.optIn);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await clientFetch('/network/benchmark/settings', {
      method: 'PUT',
      body: JSON.stringify({ sector: sector || null, optIn }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not save.');
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card">
        <div className="label">Participation</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>
            Sector
            <select className="input" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">—</option>
              {settings.sectors.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            Contribute our anonymised ratios to the sector benchmark
          </label>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        {err && <p style={{ color: 'var(--critical)', fontSize: 13, marginTop: 6 }}>{err}</p>}
      </section>

      {view && !view.eligible && (
        <section className="card">
          <p style={{ marginTop: 0 }}>
            Choose a sector above to see how you compare — the benchmark is grouped by sector.
          </p>
        </section>
      )}

      {view && view.eligible && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="label">
              {view.sector?.replace(/_/g, ' ')} · {view.period ?? 'no data yet'}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              {view.contributors != null
                ? `${view.contributors} organisation(s) in this bucket`
                : 'bucket not published'}
              {!view.optIn ? ' · you are not contributing' : ''}
            </span>
          </div>
          {view.reason === 'no_data' && (
            <p className="muted" style={{ fontSize: 13 }}>
              No benchmark has been published for your sector yet.
            </p>
          )}
          <div style={{ display: 'grid', gap: 14, marginTop: 8 }}>
            {view.metrics.map((m) => (
              <MetricRow key={m.metric} m={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MetricRow({ m }: { m: MetricComparison }) {
  const label = METRIC_LABEL[m.metric] ?? m.metric;
  const st = STANDING_LABEL[m.standing] ?? STANDING_LABEL.unknown!;
  const b = m.bucket;
  const suppressed = !b || b.suppressed || b.median == null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <strong>{label}</strong>
        <span>
          you: {m.own == null ? '—' : `${m.own}%`}
          {!suppressed && (
            <span style={{ color: st.color }}> · {st.text}</span>
          )}
        </span>
      </div>
      {suppressed ? (
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          {b && b.suppressed
            ? `Hidden — fewer than the k-anonymity threshold of contributors (${b.contributors}).`
            : 'No sector aggregate available.'}
        </p>
      ) : (
        <>
          <div
            style={{
              position: 'relative',
              height: 10,
              borderRadius: 5,
              background: 'var(--surface-sunken)',
              marginTop: 6,
            }}
          >
            {/* p25–p75 band */}
            <span
              style={{
                position: 'absolute',
                left: `${b!.min === b!.max ? 0 : ((b!.p25! - b!.min!) / (b!.max! - b!.min!)) * 100}%`,
                width: `${
                  b!.min === b!.max ? 100 : ((b!.p75! - b!.p25!) / (b!.max! - b!.min!)) * 100
                }%`,
                top: 0,
                bottom: 0,
                background: 'var(--accent)',
                opacity: 0.35,
                borderRadius: 5,
              }}
            />
            {/* median tick */}
            <span
              style={{
                position: 'absolute',
                left: `${
                  b!.min === b!.max ? 50 : ((b!.median! - b!.min!) / (b!.max! - b!.min!)) * 100
                }%`,
                top: -2,
                bottom: -2,
                width: 2,
                background: 'var(--text-secondary)',
              }}
            />
            {/* your marker */}
            {m.positionPct != null && (
              <span
                style={{
                  position: 'absolute',
                  left: `${m.positionPct}%`,
                  top: -3,
                  bottom: -3,
                  width: 3,
                  background: 'var(--accent)',
                }}
              />
            )}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            min {b!.min}% · p25 {b!.p25}% · median {b!.median}% · p75 {b!.p75}% · max {b!.max}%
          </div>
        </>
      )}
    </div>
  );
}
