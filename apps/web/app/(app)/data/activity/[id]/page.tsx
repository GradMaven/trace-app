import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { ActivityActions } from './activity-detail-client';

export const dynamic = 'force-dynamic';

interface ActivityDetail {
  id: string;
  scope: string;
  ghgCategory: string | null;
  category: string;
  description: string | null;
  value: string;
  unit: string;
  reportingPeriod: string;
  provenance: string;
  subjectType: string;
  subjectId: string;
  occurredOn: string | null;
  evidence: Array<{ id: string; title: string; type: string; status: string }>;
  calculations: Array<{
    id: string;
    methodology: string;
    resultValueTco2e: string;
    calculationVersion: string;
    calculatedAt: string;
    current: boolean;
  }>;
}

interface EvidenceOpt {
  id: string;
  title: string;
  type: string;
  status: string;
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detailRes, evidenceRes] = await Promise.all([
    serverFetch<ActivityDetail>(`/activity-data/${id}`),
    serverFetch<{ data: EvidenceOpt[] }>('/evidence?limit=100'),
  ]);

  if (!detailRes.ok || !detailRes.data) {
    return (
      <div>
        <p style={{ color: 'var(--critical)' }}>{detailRes.error?.message ?? 'Not found.'}</p>
        <Link href="/data/activity" className="btn">
          Back
        </Link>
      </div>
    );
  }
  const a = detailRes.data;
  const linkedIds = new Set(a.evidence.map((e) => e.id));
  const linkable = (evidenceRes.data?.data ?? []).filter((e) => !linkedIds.has(e.id));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link href="/data/activity" className="muted" style={{ fontSize: 13 }}>
          ← Activity Data
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0' }}>{a.category}</h1>
        <span className="muted">
          {Number(a.value).toLocaleString()} {a.unit} · {a.scope.replace(/_/g, ' ')}
          {a.ghgCategory ? ` · ${a.ghgCategory}` : ''} · {a.reportingPeriod} ·{' '}
          <span className="tag">{a.provenance.replace(/_/g, ' ')}</span>
        </span>
        {a.description && <p className="muted">{a.description}</p>}
      </div>

      <ActivityActions
        activityId={a.id}
        linkableEvidence={linkable}
        canCalculate={a.evidence.length >= 0}
      />

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Linked evidence</h2>
        {a.evidence.length > 0 ? (
          <table>
            <tbody>
              {a.evidence.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/data/evidence/${e.id}`} style={{ color: 'var(--accent)' }}>
                      {e.title}
                    </Link>
                  </td>
                  <td className="muted">{e.type.replace(/_/g, ' ')}</td>
                  <td>
                    <span className="tag">{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No evidence linked. Calculations from this activity will not be defensible.</p>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Calculations</h2>
        {a.calculations.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Result</th>
                <th>Method</th>
                <th>Engine</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {a.calculations.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{Number(c.resultValueTco2e).toLocaleString()}</strong> tCO2e
                    {!c.current && <span className="tag" style={{ marginLeft: 6 }}>superseded</span>}
                  </td>
                  <td className="muted">{c.methodology.replace(/_/g, ' ')}</td>
                  <td className="mono muted">{c.calculationVersion}</td>
                  <td className="muted">{new Date(c.calculatedAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/carbon/calculations/${c.id}/lineage`} style={{ color: 'var(--accent)' }}>
                      Lineage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No calculation yet — run one above.</p>
        )}
      </section>
    </div>
  );
}
