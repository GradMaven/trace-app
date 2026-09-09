import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { FindingRow, type Finding } from './finding-row';

export const dynamic = 'force-dynamic';

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '200' });
  for (const k of ['status', 'severity', 'source'] as const) if (sp[k]) qs.set(k, sp[k]!);
  const res = await serverFetch<{ data: Finding[] }>(`/audit/findings?${qs.toString()}`);
  const rows = res.data?.data ?? [];

  const chip = (key: string, value: string) => {
    const next = new URLSearchParams(qs);
    next.delete('limit');
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);
    const q = next.toString();
    return (
      <Link
        key={`${key}:${value}`}
        href={`/audit/findings${q ? `?${q}` : ''}`}
        className="tag"
        style={{
          color: qs.get(key) === value ? 'var(--accent)' : undefined,
          textDecoration: 'none',
        }}
      >
        {value}
      </Link>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Audit — Findings</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Issues against audit readiness. Simulation findings refresh on each run and auto-resolve
          when no longer detected; <em>accepted risk</em> and <em>dismissed</em> are sticky. Each
          points at the object to fix.
        </p>
        <Link href="/audit/readiness" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Readiness
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12 }}>
          status:
        </span>
        {['open', 'acknowledged', 'remediating', 'resolved', 'accepted_risk', 'dismissed'].map(
          (v) => chip('status', v),
        )}
        <span className="muted" style={{ fontSize: 12, marginLeft: 12 }}>
          severity:
        </span>
        {['critical', 'warning', 'info'].map((v) => chip('severity', v))}
        <span className="muted" style={{ fontSize: 12, marginLeft: 12 }}>
          source:
        </span>
        {['manual', 'simulation'].map((v) => chip('source', v))}
      </div>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Finding</th>
              <th>Subject</th>
              <th>Source</th>
              <th>Status</th>
              <th style={{ width: 320 }}>Triage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No findings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
