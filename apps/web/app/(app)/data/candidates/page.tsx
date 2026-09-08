import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Candidate {
  id: string;
  documentId: string;
  metricKey: string;
  label: string;
  value: string | null;
  unit: string | null;
  reportingPeriod: string | null;
  provenanceGuess: string;
  confidence: string;
  status: string;
  rationale: string | null;
  createdAt: string;
}

function confColor(c: number): string {
  return c >= 75 ? 'var(--positive)' : c >= 50 ? 'var(--info)' : 'var(--attention)';
}

export default async function CandidatesPage() {
  const res = await serverFetch<{ data: Candidate[] }>('/candidate-datapoints?status=pending&limit=200');
  const rows = res.data?.data ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Review Queue</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        AI-extracted candidate datapoints awaiting human review. Nothing here is trusted data —
        promote a candidate to create a real datapoint backed by evidence from its source document,
        or reject it.
      </p>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Period</th>
              <th>Provenance (guess)</th>
              <th>Confidence</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/data/candidates/${c.id}`} style={{ color: 'var(--accent)' }}>
                    {c.label}
                  </Link>
                  <div className="mono muted" style={{ fontSize: 12 }}>
                    {c.metricKey}
                  </div>
                </td>
                <td>
                  {c.value ?? '—'} {c.unit ?? ''}
                </td>
                <td className="muted">{c.reportingPeriod ?? '—'}</td>
                <td>
                  <span className="tag">{c.provenanceGuess.replace(/_/g, ' ')}</span>
                </td>
                <td>
                  <span style={{ color: confColor(Number(c.confidence)), fontWeight: 600 }}>
                    {Math.round(Number(c.confidence))}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link href={`/data/candidates/${c.id}`} className="btn">
                    Review
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing to review. Process a document from Documents or Evidence.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
