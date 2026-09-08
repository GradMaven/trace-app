import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { EvidenceActions, DownloadButton } from './evidence-detail-client';

export const dynamic = 'force-dynamic';

interface EvidenceDetail {
  id: string;
  type: string;
  title: string;
  status: string;
  version: number;
  source: string;
  sourceUrl: string | null;
  reportingPeriod: string | null;
  issuer: string | null;
  hash: string;
  createdAt: string;
  nextStates: string[];
  document: {
    id: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    checksumSha256: string;
    scanStatus: string;
  } | null;
  versionChain: {
    supersedes: { id: string; version: number; status: string } | null;
    supersededBy: Array<{ id: string; version: number; status: string }>;
  };
  verifications: Array<{
    id: string;
    method: string;
    outcome: string;
    verifiedByUserId: string;
    verifiedAt: string;
    notes: string | null;
  }>;
  datapoints: Array<{
    id: string;
    metricKey: string;
    value: string | null;
    unit: string | null;
    provenance: string;
    subjectType: string;
    subjectId: string;
    linkedAt: string;
  }>;
}

export default async function EvidenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<EvidenceDetail>(`/evidence/${id}`);

  if (!res.ok || !res.data) {
    return (
      <div>
        <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Evidence not found.'}</p>
        <Link href="/data/evidence" className="btn">
          Back
        </Link>
      </div>
    );
  }
  const e = res.data;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link href="/data/evidence" className="muted" style={{ fontSize: 13 }}>
          ← Evidence
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0' }}>{e.title}</h1>
        <span className="muted">
          {e.type.replace(/_/g, ' ')} · <span className="tag">{e.status}</span> · v{e.version} ·{' '}
          source {e.source}
          {e.reportingPeriod ? ` · ${e.reportingPeriod}` : ''}
        </span>
        <div className="mono muted" style={{ fontSize: 12, marginTop: 6 }}>
          hash {e.hash.slice(0, 24)}…
        </div>
      </div>

      <EvidenceActions
        evidenceId={e.id}
        nextStates={e.nextStates}
        status={e.status}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Document</h2>
          {e.document ? (
            <div>
              <div>{e.document.filename}</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {e.document.mime} · {(e.document.sizeBytes / 1024).toFixed(1)} KB · scan{' '}
                {e.document.scanStatus}
              </div>
              <div className="mono muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
                sha256 {e.document.checksumSha256.slice(0, 24)}…
              </div>
              <DownloadButton documentId={e.document.id} />
            </div>
          ) : e.sourceUrl ? (
            <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="btn">
              Open source link
            </a>
          ) : (
            <p className="muted">No document or source link attached.</p>
          )}
        </section>

        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Version chain</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {e.versionChain.supersedes && (
              <li>
                <Link href={`/data/evidence/${e.versionChain.supersedes.id}`} style={{ color: 'var(--accent)' }}>
                  v{e.versionChain.supersedes.version}
                </Link>{' '}
                <span className="muted">(superseded)</span>
              </li>
            )}
            <li>
              <strong>v{e.version}</strong> <span className="muted">(this)</span>
            </li>
            {e.versionChain.supersededBy.map((s) => (
              <li key={s.id}>
                <Link href={`/data/evidence/${s.id}`} style={{ color: 'var(--accent)' }}>
                  v{s.version}
                </Link>{' '}
                <span className="muted">({s.status})</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Verifications</h2>
        {e.verifications.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Method</th>
                <th>When</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {e.verifications.map((v) => (
                <tr key={v.id}>
                  <td>
                    <span
                      className="tag"
                      style={{ color: v.outcome === 'verified' ? 'var(--positive)' : 'var(--critical)' }}
                    >
                      {v.outcome}
                    </span>
                  </td>
                  <td className="muted">{v.method}</td>
                  <td className="muted">{new Date(v.verifiedAt).toLocaleString()}</td>
                  <td className="muted">{v.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Not yet verified.</p>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Linked datapoints</h2>
        {e.datapoints.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Provenance</th>
                <th>Subject</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {e.datapoints.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.metricKey}</td>
                  <td>
                    {d.value ?? '—'} {d.unit ?? ''}
                  </td>
                  <td>
                    <span className="tag">{d.provenance.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="muted">
                    {d.subjectType} · {d.subjectId.slice(0, 8)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href={`/data/datapoints/${d.id}`} style={{ color: 'var(--accent)' }}>
                      DNA
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No datapoints linked yet.</p>
        )}
      </section>
    </div>
  );
}
