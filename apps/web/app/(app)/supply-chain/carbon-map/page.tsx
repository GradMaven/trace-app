import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Row {
  supplierId: string;
  name: string;
  country: string | null;
  category: string | null;
  tier: number | null;
  annualSpendEur: number | null;
  emissionsTco2e: number | null;
  provenance: string | null;
  methodology: string | null;
  trustScore: number | null;
  hasPassport: boolean;
  carbonIntensityPerKEur: number | null;
  emissionsSharePct: number | null;
  spendSharePct: number | null;
  intensityRank: number | null;
  attributionQuality: string;
  flags: string[];
}

interface Opportunity {
  kind: string;
  supplierId: string;
  supplierName: string;
  title: string;
  detail: string;
  estimatedSavingTco2e: number | null;
}

interface Comparison {
  engineVersion: string;
  reportingPeriod: string | null;
  rows: Row[];
  totals: {
    suppliers: number;
    withEmissions: number;
    totalEmissionsTco2e: number;
    totalSpendEur: number;
    medianIntensityPerKEur: number | null;
    spendBasedShareOfEmissionsPct: number;
  };
  opportunities: Opportunity[];
}

const QUALITY_LABEL: Record<string, string> = {
  supplier_specific: 'supplier-specific',
  spend_based: 'spend-based',
  other: 'calculated',
  none: '—',
};

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));

export default async function CarbonMapPage() {
  const res = await serverFetch<Comparison>('/procurement/suppliers');
  const c = res.data;
  if (!c) {
    return <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Failed to load.'}</p>;
  }
  const maxIntensity = Math.max(0.0001, ...c.rows.map((r) => r.carbonIntensityPerKEur ?? 0));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Supply Chain — Carbon Map</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Suppliers ranked by <strong>carbon intensity</strong> (tCO2e per €1,000 of annual spend)
            for {c.reportingPeriod ?? 'the active period'}. Attribution quality is shown per row —
            spend-based estimates are the weakest and the first to refine.
          </p>
        </div>
        <Link href="/supply-chain/carbon-map/scenarios" className="btn">
          Procurement scenarios →
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="Attributed emissions" value={`${fmt(c.totals.totalEmissionsTco2e)} tCO2e`} />
        <Stat
          label="Suppliers with emissions"
          value={`${c.totals.withEmissions} / ${c.totals.suppliers}`}
        />
        <Stat label="Annual spend" value={`€${fmt(c.totals.totalSpendEur)}`} />
        <Stat
          label="Median intensity"
          value={
            c.totals.medianIntensityPerKEur == null
              ? '—'
              : `${c.totals.medianIntensityPerKEur} /€1k`
          }
        />
        <Stat
          label="Spend-based share"
          value={`${c.totals.spendBasedShareOfEmissionsPct}%`}
          color={c.totals.spendBasedShareOfEmissionsPct > 50 ? 'var(--attention)' : undefined}
        />
      </div>

      {c.opportunities.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Reduction opportunities</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
            {c.opportunities.map((o, i) => (
              <li key={`${o.kind}-${o.supplierId}-${i}`}>
                <strong>{o.title}</strong>
                {o.estimatedSavingTco2e != null && (
                  <span style={{ color: 'var(--positive)' }}>
                    {' '}
                    · ~{o.estimatedSavingTco2e} tCO2e
                  </span>
                )}
                <div className="muted" style={{ fontSize: 13 }}>
                  {o.detail}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Supplier</th>
              <th style={{ textAlign: 'right' }}>Spend</th>
              <th style={{ textAlign: 'right' }}>Emissions</th>
              <th style={{ width: 200 }}>Intensity (tCO2e/€1k)</th>
              <th>Attribution</th>
              <th>Trust</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.supplierId}>
                <td className="muted">{r.intensityRank ?? '—'}</td>
                <td>
                  <Link
                    href={`/supply-chain/suppliers/${r.supplierId}`}
                    style={{ color: 'var(--accent)' }}
                  >
                    {r.name}
                  </Link>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {[r.category, r.country, r.tier ? `tier ${r.tier}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }} className="muted">
                  {r.annualSpendEur == null ? '—' : `€${fmt(r.annualSpendEur)}`}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {r.emissionsTco2e == null ? '—' : <strong>{fmt(r.emissionsTco2e)}</strong>}
                  {r.emissionsSharePct != null && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {' '}
                      {r.emissionsSharePct}%
                    </span>
                  )}
                </td>
                <td>
                  {r.carbonIntensityPerKEur == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        width: '100%',
                      }}
                    >
                      <span
                        style={{
                          position: 'relative',
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          background: 'var(--surface-sunken)',
                          overflow: 'hidden',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: `${(r.carbonIntensityPerKEur / maxIntensity) * 100}%`,
                            background: 'var(--accent)',
                          }}
                        />
                      </span>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {r.carbonIntensityPerKEur}
                      </span>
                    </span>
                  )}
                </td>
                <td className="muted">
                  {QUALITY_LABEL[r.attributionQuality] ?? r.attributionQuality}
                </td>
                <td
                  style={{
                    color:
                      r.trustScore != null && r.trustScore < 50 ? 'var(--critical)' : undefined,
                  }}
                >
                  {r.trustScore ?? '—'}
                </td>
                <td>
                  {r.flags.map((f) => (
                    <span key={f} className="tag" style={{ fontSize: 11 }}>
                      {f}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mono muted" style={{ fontSize: 11, margin: 0 }}>
        {c.engineVersion}
      </p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ minWidth: 140 }}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
