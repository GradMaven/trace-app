import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface CalcRow {
  id: string;
  scope: string;
  ghgCategory: string | null;
  methodology: string;
  reportingPeriod: string;
  resultValueTco2e: string;
  calculationVersion: string;
  current: boolean;
  approved: boolean;
  calculatedAt: string;
}

export default async function CalculationsPage() {
  const res = await serverFetch<{ data: CalcRow[] }>('/calculations?limit=200');
  const rows = res.data?.data ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Calculations</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Every calculation is immutable and reproducible from its stored inputs. Recomputing
        chains a new version; the old row is kept.
      </p>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Result</th>
              <th>Scope</th>
              <th>Category</th>
              <th>Method</th>
              <th>Period</th>
              <th>Engine</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={c.current ? undefined : { opacity: 0.55 }}>
                <td>
                  <strong>{Number(c.resultValueTco2e).toLocaleString()}</strong> tCO2e
                </td>
                <td className="muted">{c.scope.replace(/_/g, ' ')}</td>
                <td className="muted">{c.ghgCategory?.replace(/^cat_(\d+).*/, 'cat $1') ?? '—'}</td>
                <td className="muted">{c.methodology.replace(/_/g, ' ')}</td>
                <td className="muted">{c.reportingPeriod}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {c.calculationVersion}
                </td>
                <td>
                  {!c.current && <span className="tag">superseded</span>}
                  {c.current && c.approved && (
                    <span className="tag" style={{ color: 'var(--positive)' }}>approved</span>
                  )}
                  {c.current && !c.approved && <span className="muted">pending</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/carbon/calculations/${c.id}/lineage`} style={{ color: 'var(--accent)' }}>
                    Lineage
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No calculations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
