import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { Disclaimer } from '@/components/compliance-bits';
import { GenerateFiling } from './filing-actions';

export const dynamic = 'force-dynamic';

export interface FilingStats {
  requiredDatapoints: number;
  reported: number;
  flagged: number;
  gaps: number;
  evidenceItems: number;
  disclosures: number;
  disclosuresComplete: number;
}
export interface FilingGap {
  requirementCode: string;
  disclosureCode: string;
  datapointKey: string;
  label: string;
  reasons: string[];
}
export interface FilingRow {
  id: string;
  version: number;
  regulationKey: string;
  ruleStoreVersion: string;
  reportingPeriod: string;
  formatVersion: string;
  readiness: string;
  requiredDatapoints: number;
  reportedDatapoints: number;
  gapCount: number;
  sha256: string;
  generatedByUserId: string | null;
  generatedAt: string;
  summary: { stats: FilingStats; gaps: FilingGap[]; blockers: string[]; readiness: string };
}

function ReadinessTag({ readiness }: { readiness: string }) {
  const ready = readiness === 'ready';
  return (
    <span
      className="tag"
      style={{ color: ready ? 'var(--positive)' : 'var(--critical)' }}
      data-readiness={readiness}
    >
      {ready ? 'ready to file' : 'do not file'}
    </span>
  );
}

export default async function FilingsPage() {
  const res = await serverFetch<FilingRow[]>('/filings');
  const rows = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Compliance — Regulatory Filings</h1>
          <p className="muted" style={{ marginTop: 4, maxWidth: 720 }}>
            Assemble an ESRS/CSRD-style disclosure document from the platform&apos;s own data —
            every required datapoint with its value, trust score and evidence refs, plus a
            completeness report. A &ldquo;do not file&rdquo; guard blocks the filing while required
            datapoints are missing, unverified, awaiting review, or the audit-log chain does not
            verify. Machine-readable JSON and a tagged HTML rendering are stored immutably per
            version.
          </p>
          <Link href="/compliance/gaps" style={{ color: 'var(--accent)', fontSize: 13 }}>
            ← Gaps
          </Link>
        </div>
        <GenerateFiling />
      </div>

      <Disclaimer>
        This export is a preparation aid built from your own data. It does not assert conformity
        with any regulation. Your organisation and its assurance provider remain responsible for
        any submission.
      </Disclaimer>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      {rows.length === 0 ? (
        <p className="notice">
          No filings generated yet. Generate one to see the datapoint-by-datapoint disclosure and
          the gap report.
        </p>
      ) : (
        rows.map((f) => (
          <section key={f.id} className="card">
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <ReadinessTag readiness={f.readiness} />
              <strong style={{ fontSize: 14 }}>
                {f.regulationKey} · {f.reportingPeriod} · v{f.version}
              </strong>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {f.sha256.slice(0, 16)}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {f.ruleStoreVersion} · {f.formatVersion} ·{' '}
                {new Date(f.generatedAt).toLocaleString()}
              </span>
              <Link
                href={`/compliance/filings/${f.id}`}
                style={{ marginLeft: 'auto', color: 'var(--accent)', fontSize: 13 }}
              >
                open →
              </Link>
            </div>
            <div
              className="muted"
              style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}
            >
              <span>{f.summary.stats.requiredDatapoints} required</span>
              <span style={{ color: 'var(--positive)' }}>{f.summary.stats.reported} reported</span>
              <span style={{ color: f.summary.stats.flagged ? 'var(--attention)' : undefined }}>
                {f.summary.stats.flagged} flagged
              </span>
              <span style={{ color: f.gapCount ? 'var(--critical)' : undefined }}>
                {f.gapCount} gaps
              </span>
              <span>{f.summary.stats.evidenceItems} evidence items</span>
              <span>
                {f.summary.stats.disclosuresComplete}/{f.summary.stats.disclosures} disclosures
                complete
              </span>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
