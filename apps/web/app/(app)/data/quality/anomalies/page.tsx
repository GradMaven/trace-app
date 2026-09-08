import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { AnomalyRow, type Anomaly } from './anomaly-row';

export const dynamic = 'force-dynamic';

export default async function AnomaliesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '200' });
  if (sp.status) qs.set('status', sp.status);
  const res = await serverFetch<{ data: Anomaly[] }>(`/data-quality/anomalies?${qs.toString()}`);
  const rows = res.data?.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Anomalies</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Flagged by deterministic statistics — a modified z-score against a datapoint&apos;s own
          history or its peers, and large period-over-period steps. Each carries candidate
          explanations for a human to confirm or dismiss; nothing here changes a number.
        </p>
        <Link href="/data/quality" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Data Quality
        </Link>
      </div>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Metric / subject</th>
              <th>Observed → expected</th>
              <th>Score</th>
              <th>Explanation</th>
              <th>Status</th>
              <th style={{ width: 190 }}>Triage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <AnomalyRow key={a.id} anomaly={a} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No anomalies.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
