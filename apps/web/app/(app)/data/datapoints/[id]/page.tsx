import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface DatapointDNA {
  id: string;
  metricKey: string;
  value: string | null;
  valueText: string | null;
  unit: string | null;
  provenance: string;
  label: string;
  reportingPeriod: string | null;
  subjectType: string;
  subjectId: string;
  createdAt: string;
  evidence: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    reportingPeriod: string | null;
    documentId: string | null;
    linkedAt: string;
  }>;
}

export default async function DatapointDnaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<DatapointDNA>(`/datapoints/${id}`);
  if (!res.ok || !res.data) {
    return <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Datapoint not found.'}</p>;
  }
  const d = res.data;
  const verified = d.evidence.filter((e) => e.status === 'verified').length;

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 720 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Evidence DNA</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Where this number comes from and what supports it.
        </p>
      </div>

      <div className="card">
        <div style={{ fontSize: 28, fontWeight: 600 }}>
          {d.value ?? d.valueText ?? '—'}
          {d.unit ? <span style={{ fontSize: 16, fontWeight: 400 }}> {d.unit}</span> : null}
        </div>
        <div className="mono muted" style={{ marginTop: 4 }}>
          {d.metricKey}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <span className="tag">provenance: {d.provenance.replace(/_/g, ' ')}</span>
          <span className="tag">label: {d.label.replace(/_/g, ' ')}</span>
          {d.reportingPeriod && <span className="tag">period: {d.reportingPeriod}</span>}
          <span className="tag">
            subject: {d.subjectType} · {d.subjectId.slice(0, 8)}
          </span>
        </div>
      </div>

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Supporting evidence</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            {d.evidence.length} linked · {verified} verified
          </span>
        </div>
        {d.evidence.length === 0 ? (
          <p className="notice">
            No evidence linked. This datapoint is not yet defensible — link at least one evidence
            record.
          </p>
        ) : (
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
            {d.evidence.map((e) => (
              <li key={e.id}>
                <Link href={`/data/evidence/${e.id}`} style={{ color: 'var(--accent)' }}>
                  {e.title}
                </Link>{' '}
                <span className="muted">
                  — {e.type.replace(/_/g, ' ')} · <span className="tag">{e.status}</span>
                  {e.reportingPeriod ? ` · ${e.reportingPeriod}` : ''}
                  {e.documentId ? ' · has document' : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
