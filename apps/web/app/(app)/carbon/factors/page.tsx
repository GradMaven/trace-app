import { serverFetch } from '@/lib/server-api';
import { AddFactor } from './factors-client';

export const dynamic = 'force-dynamic';

interface Factor {
  id: string;
  scopeSet: string;
  source: string;
  sourceRef: string;
  name: string;
  value: string;
  unit: string;
  dimension: string | null;
  gwpSet: string;
  scope: string;
  ghgCategory: string | null;
  geography: string | null;
  methodology: string | null;
  version: number;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
}

export default async function FactorsPage() {
  const res = await serverFetch<Factor[]>('/emission-factors');
  const rows = res.data ?? [];
  const library = rows.filter((f) => f.scopeSet === 'library');
  const custom = rows.filter((f) => f.scopeSet === 'organization');

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Emission Factors</h1>
        <AddFactor />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Calculations pin a specific factor version, so historical results never change when a
        factor is updated. Organization-specific factors are preferred over the shared library.
      </p>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <FactorTable title={`Organization factors (${custom.length})`} rows={custom} />
      <FactorTable title={`Shared library (${library.length})`} rows={library} />
    </div>
  );
}

function FactorTable({ title, rows }: { title: string; rows: Factor[] }) {
  return (
    <section className="card" style={{ padding: 0 }}>
      <h2 style={{ fontSize: 15, margin: 0, padding: '16px 16px 0' }}>{title}</h2>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th>Scope / category</th>
              <th>Geo</th>
              <th>Method</th>
              <th>Valid</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td className="mono">
                  {f.value} {f.unit}
                </td>
                <td className="muted">
                  {f.scope.replace(/_/g, ' ')}
                  {f.ghgCategory ? ` · ${f.ghgCategory.replace(/^cat_(\d+).*/, 'cat $1')}` : ''}
                </td>
                <td className="muted">{f.geography ?? '—'}</td>
                <td className="muted">{f.methodology?.replace(/_/g, ' ') ?? '—'}</td>
                <td className="muted">
                  {f.validFrom}
                  {f.validTo ? `–${f.validTo}` : '+'}
                </td>
                <td className="muted mono" style={{ fontSize: 12 }}>
                  {f.source}:{f.sourceRef} v{f.version}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  None.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
