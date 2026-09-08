import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { CreateActivity } from './activity-client';

export const dynamic = 'force-dynamic';

interface ActivityItem {
  id: string;
  scope: string;
  ghgCategory: string | null;
  category: string;
  value: string;
  unit: string;
  reportingPeriod: string;
  provenance: string;
  evidenceCount: number;
  calculationCount: number;
}

interface Unit {
  code: string;
  dimension: string;
  label: string;
}

export default async function ActivityPage() {
  const [res, unitsRes] = await Promise.all([
    serverFetch<{ data: ActivityItem[] }>('/activity-data?limit=100'),
    serverFetch<Unit[]>('/emission-factors/units'),
  ]);
  const rows = res.data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Activity Data</h1>
        <CreateActivity units={unitsRes.data ?? []} />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Quantified activities (fuel, electricity, purchased goods, freight…). Each links to
        evidence and drives a deterministic emissions calculation.
      </p>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Scope</th>
              <th>Quantity</th>
              <th>Period</th>
              <th>Provenance</th>
              <th>Evidence</th>
              <th>Calcs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/data/activity/${a.id}`} style={{ color: 'var(--accent)' }}>
                    {a.category}
                  </Link>
                </td>
                <td className="muted">
                  {a.scope.replace('scope_', 'S').replace('_location', ' (loc)').replace('_market', ' (mkt)')}
                  {a.ghgCategory ? ` · ${a.ghgCategory.replace(/^cat_(\d+).*/, 'cat $1')}` : ''}
                </td>
                <td>
                  {Number(a.value).toLocaleString()} {a.unit}
                </td>
                <td className="muted">{a.reportingPeriod}</td>
                <td>
                  <span className="tag">{a.provenance.replace(/_/g, ' ')}</span>
                </td>
                <td>{a.evidenceCount || <span className="muted">0</span>}</td>
                <td>{a.calculationCount || <span className="muted">0</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No activity data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
