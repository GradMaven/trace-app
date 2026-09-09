import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Control {
  id: string;
  key: string;
  name: string;
  description: string;
  owner: string | null;
  status: string;
  lastTestedAt: string | null;
  note: string | null;
}

const STATUS_COLOR: Record<string, string | undefined> = {
  passed: 'var(--positive)',
  implemented: 'var(--positive)',
  needs_testing: 'var(--attention)',
  failed: 'var(--critical)',
  not_implemented: 'var(--critical)',
};

export default async function ControlsPage() {
  const res = await serverFetch<Control[]>('/compliance/controls?version=esrs@2026.1');
  const rows = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Audit — Controls</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Organization-level controls expected for the loaded requirements. Edit a control from its
          disclosure page under Compliance.
        </p>
      </div>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Control</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Last tested</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <div>{c.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {c.description}
                  </div>
                </td>
                <td className="muted">{c.owner ?? '—'}</td>
                <td>
                  <span className="tag" style={{ color: STATUS_COLOR[c.status] }}>
                    {c.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="muted">
                  {c.lastTestedAt ? new Date(c.lastTestedAt).toLocaleDateString() : '—'}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {c.note ?? ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No controls recorded. Add them from the Compliance disclosure pages.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
