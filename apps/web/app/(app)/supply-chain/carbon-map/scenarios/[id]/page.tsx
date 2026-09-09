import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface LineResult {
  supplierName: string;
  label: string;
  baselineTco2e: string;
  projectedTco2e: string;
  deltaTco2e: string;
  changed: boolean;
  note: string;
}

interface Scenario {
  id: string;
  name: string;
  description: string | null;
  reportingPeriod: string | null;
  engineVersion: string;
  baselineTco2e: string;
  projectedTco2e: string;
  deltaTco2e: string;
  deltaPct: string;
  result: { lines: LineResult[] };
  createdAt: string;
}

const num = (v: string) => Number(v).toLocaleString('en-US');

export default async function ScenarioDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<Scenario>(`/procurement/scenarios/${id}`);
  if (!res.ok || !res.data) {
    return (
      <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Scenario not found.'}</p>
    );
  }
  const s = res.data;
  const down = Number(s.deltaTco2e) < 0;

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
      <div>
        <Link
          href="/supply-chain/carbon-map/scenarios"
          style={{ color: 'var(--accent)', fontSize: 13 }}
        >
          ← Procurement Scenarios
        </Link>
        <h1 style={{ fontSize: 20, margin: '6px 0 0' }}>{s.name}</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {s.description ?? 'Deterministic what-if over the current calculation inputs.'} ·{' '}
          {s.reportingPeriod ?? 'active period'} · {new Date(s.createdAt).toLocaleString()}
        </p>
      </div>

      <div
        className="card"
        style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'baseline' }}
      >
        <div>
          <div className="label">Baseline</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {num(s.baselineTco2e)} <span style={{ fontSize: 13, fontWeight: 400 }}>tCO2e</span>
          </div>
        </div>
        <div style={{ fontSize: 22, color: 'var(--text-muted)' }}>→</div>
        <div>
          <div className="label">Projected</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {num(s.projectedTco2e)} <span style={{ fontSize: 13, fontWeight: 400 }}>tCO2e</span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <div className="label">Change</div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: down ? 'var(--positive)' : 'var(--critical)',
            }}
          >
            {Number(s.deltaTco2e) > 0 ? '+' : ''}
            {num(s.deltaTco2e)}{' '}
            <span style={{ fontSize: 13, fontWeight: 400 }}>tCO2e ({s.deltaPct}%)</span>
          </div>
        </div>
      </div>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Line</th>
              <th style={{ textAlign: 'right' }}>Baseline</th>
              <th style={{ textAlign: 'right' }}>Projected</th>
              <th style={{ textAlign: 'right' }}>Delta</th>
              <th>Change applied</th>
            </tr>
          </thead>
          <tbody>
            {s.result.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.supplierName}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {l.label}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>{num(l.baselineTco2e)}</td>
                <td style={{ textAlign: 'right' }}>{num(l.projectedTco2e)}</td>
                <td
                  style={{
                    textAlign: 'right',
                    color:
                      Number(l.deltaTco2e) < 0
                        ? 'var(--positive)'
                        : Number(l.deltaTco2e) > 0
                          ? 'var(--critical)'
                          : undefined,
                  }}
                >
                  {Number(l.deltaTco2e) > 0 ? '+' : ''}
                  {num(l.deltaTco2e)}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {l.changed ? l.note : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mono muted" style={{ fontSize: 11, margin: 0 }}>
        {s.engineVersion}
      </p>
    </div>
  );
}
