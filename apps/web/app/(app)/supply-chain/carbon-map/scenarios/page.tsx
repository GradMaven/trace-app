import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { ScenarioBuilder } from './scenario-builder';

export const dynamic = 'force-dynamic';

interface Scenario {
  id: string;
  name: string;
  reportingPeriod: string | null;
  baselineTco2e: string;
  projectedTco2e: string;
  deltaTco2e: string;
  deltaPct: string;
  createdAt: string;
}

export default async function ScenariosPage() {
  const res = await serverFetch<Scenario[]>('/procurement/scenarios');
  const rows = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Procurement Scenarios</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Model a supplier switch, a volume cut or a cleaner emission factor. Each scenario re-runs
          the deterministic carbon engine on the current calculation inputs — it never changes the
          reported numbers.
        </p>
        <Link href="/supply-chain/carbon-map" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Carbon Map
        </Link>
      </div>

      <ScenarioBuilder />

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Saved scenarios</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Period</th>
              <th style={{ textAlign: 'right' }}>Baseline</th>
              <th style={{ textAlign: 'right' }}>Projected</th>
              <th style={{ textAlign: 'right' }}>Delta</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link
                    href={`/supply-chain/carbon-map/scenarios/${s.id}`}
                    style={{ color: 'var(--accent)' }}
                  >
                    {s.name}
                  </Link>
                </td>
                <td className="muted">{s.reportingPeriod ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {Number(s.baselineTco2e).toLocaleString('en-US')}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {Number(s.projectedTco2e).toLocaleString('en-US')}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    color: Number(s.deltaTco2e) < 0 ? 'var(--positive)' : 'var(--critical)',
                  }}
                >
                  {Number(s.deltaTco2e) > 0 ? '+' : ''}
                  {Number(s.deltaTco2e).toLocaleString('en-US')} ({s.deltaPct}%)
                </td>
                <td className="muted">{new Date(s.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No scenarios yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
