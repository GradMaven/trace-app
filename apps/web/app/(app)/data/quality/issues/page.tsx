import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { IssueRow, type Issue } from './issue-row';

export const dynamic = 'force-dynamic';

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '200' });
  if (sp.status) qs.set('status', sp.status);
  if (sp.severity) qs.set('severity', sp.severity);
  const res = await serverFetch<{ data: Issue[] }>(`/data-quality/issues?${qs.toString()}`);
  const rows = res.data?.data ?? [];

  const filter = (key: string, value: string, label: string) => {
    const next = new URLSearchParams(qs);
    next.delete('limit');
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);
    const q = next.toString();
    const active = qs.get(key) === value;
    return (
      <Link
        href={`/data/quality/issues${q ? `?${q}` : ''}`}
        className="tag"
        style={{ color: active ? 'var(--accent)' : undefined, textDecoration: 'none' }}
      >
        {label}
      </Link>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Data-quality issues</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Detected by deterministic rules ({rows[0]?.rulesVersion ?? 'quality-rules'}). Re-scans
          refresh open issues and auto-resolve ones no longer detected; dismissing records a human
          judgement.
        </p>
        <Link href="/data/quality" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Data Quality
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          status:
        </span>
        {filter('status', 'open', 'open')}
        {filter('status', 'acknowledged', 'acknowledged')}
        {filter('status', 'resolved', 'resolved')}
        {filter('status', 'dismissed', 'dismissed')}
        <span className="muted" style={{ fontSize: 12, marginLeft: 12 }}>
          severity:
        </span>
        {filter('severity', 'critical', 'critical')}
        {filter('severity', 'warning', 'warning')}
        {filter('severity', 'info', 'info')}
      </div>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Issue</th>
              <th>Metric / subject</th>
              <th>Status</th>
              <th>Last seen</th>
              <th style={{ width: 220 }}>Triage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <IssueRow key={i.id} issue={i} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No issues match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
