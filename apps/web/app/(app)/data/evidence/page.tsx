import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { AddEvidence } from './evidence-client';

export const dynamic = 'force-dynamic';

interface EvidenceItem {
  id: string;
  type: string;
  title: string;
  status: string;
  version: number;
  reportingPeriod: string | null;
  hasDocument: boolean;
  datapointCount: number;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  verified: 'var(--positive)',
  rejected: 'var(--critical)',
  reviewed: 'var(--info)',
  uploaded: 'var(--text-muted)',
  processing: 'var(--attention)',
  extracted: 'var(--attention)',
  expired: 'var(--critical)',
  superseded: 'var(--text-muted)',
};

export default async function EvidencePage() {
  const res = await serverFetch<{ data: EvidenceItem[] }>('/evidence?limit=100');
  const rows = res.data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Evidence</h1>
        <AddEvidence />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Every material datapoint can be linked to evidence. Evidence moves through a lifecycle —
        uploaded → reviewed → verified — and is versioned.
      </p>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Period</th>
              <th>Document</th>
              <th>Datapoints</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/data/evidence/${e.id}`} style={{ color: 'var(--accent)' }}>
                    {e.title}
                  </Link>
                  {e.version > 1 && <span className="tag" style={{ marginLeft: 6 }}>v{e.version}</span>}
                </td>
                <td className="muted">{e.type.replace(/_/g, ' ')}</td>
                <td>
                  <span className="tag" style={{ color: STATUS_COLOR[e.status] }}>
                    {e.status}
                  </span>
                </td>
                <td className="muted">{e.reportingPeriod ?? '—'}</td>
                <td>{e.hasDocument ? 'yes' : <span className="muted">—</span>}</td>
                <td>{e.datapointCount || <span className="muted">0</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No evidence yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
