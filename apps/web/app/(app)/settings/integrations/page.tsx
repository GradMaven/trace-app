import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Integration {
  id: string;
  kind: string;
  name: string;
  status: string;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

interface Run {
  id: string;
  kind: string;
  status: string;
  fileName: string | null;
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  rowsImported: number;
  startedAt: string;
  durationMs: number;
}

export default async function IntegrationsPage() {
  const [connectorsRes, runsRes] = await Promise.all([
    serverFetch<Integration[]>('/integrations'),
    serverFetch<Run[]>('/integrations/runs'),
  ]);
  const connectors = connectorsRes.data ?? [];
  const runs = runsRes.data ?? [];

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
          <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Integrations</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Bring activity data in from spreadsheets and systems. Every connector implements the
            same <span className="mono">IntegrationAdapter</span> contract; the CSV / TSV importer
            ships first. REST, SFTP and ERP adapters come next, built against a real use case.
          </p>
        </div>
        <Link href="/settings/integrations/import" className="btn">
          Import activity data →
        </Link>
      </div>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Saved connectors</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Runs</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {connectors.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {c.kind}
                </td>
                <td>
                  <span className="tag">{c.status}</span>
                </td>
                <td>{c.runCount}</td>
                <td className="muted">
                  {c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {connectors.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No saved connectors. An import still works without one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Import runs</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th>Kind</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Rows</th>
              <th style={{ textAlign: 'right' }}>Imported</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.startedAt).toLocaleString()}</td>
                <td>{r.fileName ?? '—'}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {r.kind}
                </td>
                <td>
                  <span
                    className="tag"
                    style={{
                      color:
                        r.status === 'completed'
                          ? 'var(--positive)'
                          : r.status === 'failed'
                            ? 'var(--critical)'
                            : undefined,
                    }}
                  >
                    {r.status}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }} className="muted">
                  {r.rowsValid}/{r.rowsTotal} valid
                </td>
                <td style={{ textAlign: 'right' }}>
                  <strong>{r.rowsImported}</strong>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No imports yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
