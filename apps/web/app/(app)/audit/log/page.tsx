import { serverFetch } from '@/lib/server-api';
import { VerifyChainButton } from './verify-button';
import { AuditLogTools } from './audit-log-tools';

export const dynamic = 'force-dynamic';

interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  createdAt: string;
  hash: string;
  prevHash: string;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action } = await searchParams;
  const qs = new URLSearchParams({ limit: '100' });
  if (action) qs.set('action', action);
  const res = await serverFetch<{ data: AuditEntry[]; nextCursor?: string }>(`/audit-log?${qs}`);
  const rows = res.data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Activity Log</h1>
        <VerifyChainButton />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Append-only and hash-chained. Every consequential change is recorded here.
      </p>
      <AuditLogTools action={action ?? ''} />
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Resource</th>
              <th>When</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.action}</td>
                <td className="muted">
                  {e.resourceType}
                  {e.resourceId ? ` · ${e.resourceId.slice(0, 8)}` : ''}
                </td>
                <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
                <td className="mono muted" title={e.hash}>
                  {e.hash.slice(0, 12)}…
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
