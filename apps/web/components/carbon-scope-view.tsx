import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

const PERIOD = 'FY2025';

interface Summary {
  reportingPeriod: string;
  scope1: string;
  scope2LocationBased: string;
  scope2MarketBased: string;
  scope2Reported: string;
  scope3: string;
  total: string;
  byCategory: Array<{ scope: string; ghgCategory: string | null; valueTco2e: string; count: number }>;
}

interface CalcRow {
  id: string;
  scope: string;
  ghgCategory: string | null;
  methodology: string;
  reportingPeriod: string;
  resultValueTco2e: string;
  current: boolean;
  approved: boolean;
}

const SCOPE_KEYS: Record<string, string[]> = {
  '1': ['scope_1'],
  '2': ['scope_2_location', 'scope_2_market'],
  '3': ['scope_3'],
};

export async function CarbonScopeView({ scope }: { scope: '1' | '2' | '3' }) {
  const [summaryRes, calcsRes] = await Promise.all([
    serverFetch<Summary>(`/emissions/summary?reportingPeriod=${PERIOD}`),
    serverFetch<{ data: CalcRow[] }>(`/calculations?reportingPeriod=${PERIOD}&limit=100`),
  ]);
  const s = summaryRes.data;
  const keys = SCOPE_KEYS[scope]!;
  const calcs = (calcsRes.data?.data ?? []).filter((c) => keys.includes(c.scope) && c.current);

  const headline =
    scope === '1'
      ? s?.scope1
      : scope === '2'
        ? s?.scope2Reported
        : s?.scope3;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Scope {scope} — {PERIOD}</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Computed from current (non-superseded) calculations. Recompute the inventory from the
          Command Center after adding activity data.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="label">Scope {scope} total</div>
          <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>
            {headline ? Number(headline).toLocaleString() : '—'}
            <span style={{ fontSize: 14, fontWeight: 400 }}> tCO2e</span>
          </div>
        </div>
        {scope === '2' && s && (
          <>
            <div className="card">
              <div className="label">Location-based</div>
              <div style={{ fontSize: 22, marginTop: 4 }}>{Number(s.scope2LocationBased).toLocaleString()}</div>
            </div>
            <div className="card">
              <div className="label">Market-based</div>
              <div style={{ fontSize: 22, marginTop: 4 }}>{Number(s.scope2MarketBased).toLocaleString()}</div>
            </div>
          </>
        )}
        <div className="card">
          <div className="label">Contributing calculations</div>
          <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>{calcs.length}</div>
        </div>
      </div>

      {scope === '3' && s && s.byCategory.filter((c) => c.scope === 'scope_3').length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>By category</h2>
          <table>
            <tbody>
              {s.byCategory
                .filter((c) => c.scope === 'scope_3')
                .map((c) => (
                  <tr key={c.ghgCategory}>
                    <td>{c.ghgCategory?.replace(/^cat_(\d+)_/, '$1 · ').replace(/_/g, ' ')}</td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{Number(c.valueTco2e).toLocaleString()}</strong> tCO2e
                    </td>
                    <td className="muted" style={{ textAlign: 'right' }}>
                      {c.count} calc{c.count === 1 ? '' : 's'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Calculations</h2>
        {calcs.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Result</th>
                <th>Scope</th>
                <th>Category</th>
                <th>Method</th>
                <th>Approved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {calcs.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{Number(c.resultValueTco2e).toLocaleString()}</strong> tCO2e
                  </td>
                  <td className="muted">{c.scope.replace(/_/g, ' ')}</td>
                  <td className="muted">{c.ghgCategory?.replace(/^cat_(\d+).*/, 'cat $1') ?? '—'}</td>
                  <td className="muted">{c.methodology.replace(/_/g, ' ')}</td>
                  <td>{c.approved ? <span className="tag" style={{ color: 'var(--positive)' }}>yes</span> : <span className="muted">no</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/carbon/calculations/${c.id}/lineage`} style={{ color: 'var(--accent)' }}>
                      Lineage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">
            No calculations for this scope yet. Add activity data and run a calculation.
          </p>
        )}
      </section>
    </div>
  );
}
