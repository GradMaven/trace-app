import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { TrustBreakdown } from './trust-breakdown';

export const dynamic = 'force-dynamic';

interface TrustContribution {
  dimension: string;
  max: number;
  awarded: number;
  rationale: string;
}

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
  trust: {
    score: {
      id: string;
      value: number;
      band: string;
      modelVersion: string;
      breakdown: TrustContribution[];
      computedAt: string;
    } | null;
    issues: Array<{
      id: string;
      kind: string;
      severity: string;
      status: string;
      title: string;
      detail: string;
    }>;
    anomalies: Array<{
      id: string;
      method: string;
      status: string;
      direction: string;
      observedValue: string;
      expectedValue: string;
      explanations: string[];
    }>;
  };
}

const BAND_COLOR: Record<string, string> = {
  high: 'var(--positive)',
  medium: 'var(--attention)',
  low: 'var(--critical)',
};

export default async function DatapointDnaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<DatapointDNA>(`/datapoints/${id}`);
  if (!res.ok || !res.data) {
    return (
      <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Datapoint not found.'}</p>
    );
  }
  const d = res.data;
  const verified = d.evidence.filter((e) => e.status === 'verified').length;
  const trust = d.trust;
  const openIssues = trust.issues.filter((i) => i.status === 'open' || i.status === 'acknowledged');

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 760 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Evidence DNA</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Where this number comes from, what supports it, and how trustworthy it is.
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
          }}
        >
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Trust Score</h2>
          <TrustBreakdown datapointId={d.id} />
        </div>
        {!trust.score ? (
          <p className="notice">
            Not scored yet. Run a data-quality scan (Data → Data Quality) or recompute above.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: BAND_COLOR[trust.score.band] }}>
                {trust.score.value}
              </span>
              <span className="muted">/ 100</span>
              <span className="tag" style={{ color: BAND_COLOR[trust.score.band] }}>
                {trust.score.band}
              </span>
              <span className="mono muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                {trust.score.modelVersion}
              </span>
            </div>
            <table style={{ marginTop: 12, width: '100%' }}>
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th style={{ width: 90 }}>Awarded</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {trust.score.breakdown.map((c) => (
                  <tr key={c.dimension}>
                    <td>{c.dimension.replace(/_/g, ' ')}</td>
                    <td className="mono">
                      {c.awarded} / {c.max}
                    </td>
                    <td className="muted">{c.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Computed {new Date(trust.score.computedAt).toLocaleString()}. The weight table is
              documented, versioned configuration — see docs/domain-model.md.
            </p>
          </>
        )}
      </section>

      {(openIssues.length > 0 || trust.anomalies.length > 0) && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Data-quality flags</h2>
          {openIssues.length > 0 && (
            <ul style={{ margin: '0 0 8px', paddingLeft: 18, display: 'grid', gap: 6 }}>
              {openIssues.map((i) => (
                <li key={i.id}>
                  <span
                    className="tag"
                    style={{
                      color:
                        i.severity === 'critical'
                          ? 'var(--critical)'
                          : i.severity === 'warning'
                            ? 'var(--attention)'
                            : undefined,
                    }}
                  >
                    {i.severity}
                  </span>{' '}
                  {i.title} <span className="muted">— {i.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {trust.anomalies.map((a) => (
            <p key={a.id} className="muted" style={{ margin: '4px 0', fontSize: 13 }}>
              <span className="tag">{a.method.replace(/_/g, ' ')}</span> {a.direction} — observed{' '}
              {a.observedValue}, expected ~{a.expectedValue}. {a.explanations[0]}
            </p>
          ))}
          <Link href="/data/quality/issues" style={{ color: 'var(--accent)', fontSize: 13 }}>
            Open the data-quality queue →
          </Link>
        </section>
      )}

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
