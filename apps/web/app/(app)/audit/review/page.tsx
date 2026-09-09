import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { YesNo } from '@/components/audit-bits';

export const dynamic = 'force-dynamic';

interface ReviewRow {
  datapointId: string;
  metricKey: string;
  subjectType: string;
  subjectId: string;
  value: string | null;
  unit: string | null;
  provenance: string;
  liveEvidence: number;
  verifiedEvidence: number;
  expiredEvidence: number;
  hasCalculation: boolean;
  reproduced: boolean | null;
  approved: boolean | null;
  trustScore: number | null;
  trustBand: string | null;
}

export default async function EvidenceReviewPage() {
  const res = await serverFetch<ReviewRow[]>('/audit/evidence-review');
  const rows = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Audit — Evidence Review</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Every material datapoint for the active period with its chain health: verified evidence,
          reproducible calculation, recorded approval, and Trust Score. Open one to walk the full
          chain.
        </p>
      </div>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Datapoint</th>
              <th>Value</th>
              <th>Evidence</th>
              <th>Verified</th>
              <th>Reproduces</th>
              <th>Approved</th>
              <th>Trust</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.datapointId}>
                <td>
                  <div className="mono" style={{ fontSize: 12 }}>
                    {r.metricKey}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {r.subjectType}:{r.subjectId.slice(0, 8)} · {r.provenance.replace(/_/g, ' ')}
                  </div>
                </td>
                <td className="mono">
                  {r.value ?? '—'}
                  {r.unit ? ` ${r.unit}` : ''}
                </td>
                <td className="muted">
                  {r.liveEvidence} live{r.expiredEvidence ? `, ${r.expiredEvidence} expired` : ''}
                </td>
                <td>
                  <YesNo value={r.verifiedEvidence > 0} />
                </td>
                <td>
                  <YesNo value={r.reproduced} />
                </td>
                <td>
                  <YesNo value={r.approved} />
                </td>
                <td
                  style={{
                    color:
                      r.trustBand === 'low'
                        ? 'var(--critical)'
                        : r.trustBand === 'medium'
                          ? 'var(--attention)'
                          : undefined,
                  }}
                >
                  {r.trustScore ?? '—'}
                </td>
                <td>
                  <Link
                    href={`/audit/review/${r.datapointId}`}
                    style={{ color: 'var(--accent)', fontSize: 13 }}
                  >
                    chain →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No datapoints for the active reporting period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
