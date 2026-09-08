import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { ReviewForm } from './review-client';

export const dynamic = 'force-dynamic';

interface CandidateDetail {
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
  promotedDatapointId: string | null;
  reviewNote: string | null;
  document: { id: string; filename: string; mime: string };
  sourceSpans: Array<{ sourceText: string; charStart: number | null; charEnd: number | null; page: number | null }>;
  contextWindow: string | null;
  classification: { documentType?: string; issuer?: string | null; reportingPeriod?: string | null } | null;
  aiJob: {
    id: string;
    provider: string;
    model: string;
    promptVersion: string;
    confidence: string | null;
    tokensIn: number;
    tokensOut: number;
    costEur: string;
  } | null;
}

function highlight(context: string, snippet: string) {
  const i = context.indexOf(snippet);
  if (i === -1) return <span>{context}</span>;
  return (
    <>
      <span>{context.slice(0, i)}</span>
      <mark style={{ background: 'var(--attention)', color: '#000', padding: '0 2px' }}>
        {context.slice(i, i + snippet.length)}
      </mark>
      <span>{context.slice(i + snippet.length)}</span>
    </>
  );
}

export default async function CandidateReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<CandidateDetail>(`/candidate-datapoints/${id}`);
  if (!res.ok || !res.data) {
    return (
      <div>
        <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Candidate not found.'}</p>
        <Link href="/data/candidates" className="btn">
          Back
        </Link>
      </div>
    );
  }
  const c = res.data;
  const span = c.sourceSpans[0];

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 820 }}>
      <div>
        <Link href="/data/candidates" className="muted" style={{ fontSize: 13 }}>
          ← Review Queue
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0' }}>{c.label}</h1>
        <span className="muted">
          <span className="mono">{c.metricKey}</span> ·{' '}
          <span className="tag">{c.status}</span> · from{' '}
          <Link href={`/data/documents`} style={{ color: 'var(--accent)' }}>
            {c.document.filename}
          </Link>
        </span>
      </div>

      <div className="card">
        <div style={{ fontSize: 26, fontWeight: 600 }}>
          {c.value ?? '—'} {c.unit ? <span style={{ fontSize: 15, fontWeight: 400 }}>{c.unit}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="tag">provenance guess: {c.provenanceGuess.replace(/_/g, ' ')}</span>
          {c.reportingPeriod && <span className="tag">period: {c.reportingPeriod}</span>}
          <span className="tag">confidence: {Math.round(Number(c.confidence))}</span>
        </div>
        {c.rationale && (
          <p className="muted" style={{ marginBottom: 0 }}>
            <em>{c.rationale}</em>
          </p>
        )}
      </div>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Source</h2>
        {span ? (
          <>
            <p className="muted" style={{ fontSize: 13 }}>
              {span.page != null ? `Page ${span.page} · ` : ''}
              {span.charStart != null
                ? `characters ${span.charStart}–${span.charEnd}`
                : 'exact location not found in parsed text'}
            </p>
            <pre
              className="mono"
              style={{
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                background: 'var(--surface-sunken)',
                padding: 12,
                borderRadius: 8,
                margin: 0,
              }}
            >
              {c.contextWindow ? highlight(c.contextWindow, span.sourceText) : span.sourceText}
            </pre>
          </>
        ) : (
          <p className="muted">No source span recorded.</p>
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Extraction</h2>
        <div className="muted" style={{ fontSize: 13, display: 'grid', gap: 4 }}>
          {c.classification && (
            <div>
              Classified as <strong>{c.classification.documentType}</strong>
              {c.classification.issuer ? ` · issuer ${c.classification.issuer}` : ''}
              {c.classification.reportingPeriod ? ` · ${c.classification.reportingPeriod}` : ''}
            </div>
          )}
          {c.aiJob && (
            <div>
              {c.aiJob.provider === 'stub' ? (
                <span style={{ color: 'var(--attention)' }}>
                  Extracted by the heuristic dev stub (no AI provider configured) —{' '}
                </span>
              ) : (
                <span>Model {c.aiJob.model} · </span>
              )}
              prompt {c.aiJob.promptVersion} · {c.aiJob.tokensIn}+{c.aiJob.tokensOut} tokens · €
              {Number(c.aiJob.costEur).toFixed(4)} ·{' '}
              <Link href={`/data/ai-jobs`} style={{ color: 'var(--accent)' }}>
                AI log
              </Link>
            </div>
          )}
        </div>
      </section>

      {c.status === 'pending' ? (
        <ReviewForm
          candidateId={c.id}
          defaultProvenance={c.provenanceGuess}
          defaultValue={c.value}
          defaultUnit={c.unit}
        />
      ) : (
        <div className="notice">
          Already {c.status}
          {c.reviewNote ? ` — “${c.reviewNote}”` : ''}.
          {c.promotedDatapointId && (
            <>
              {' '}
              <Link href={`/data/datapoints/${c.promotedDatapointId}`} style={{ color: 'var(--accent)' }}>
                View datapoint →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
