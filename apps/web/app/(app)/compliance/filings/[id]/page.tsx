import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { Disclaimer, GapReasons } from '@/components/compliance-bits';
import { DownloadFiling } from '../filing-actions';
import type { FilingGap, FilingRow, FilingStats } from '../page';

export const dynamic = 'force-dynamic';

interface EvidenceRef {
  id: string;
  type: string;
  title: string;
  status: string;
  hash: string;
}
interface DatapointNode {
  key: string;
  label: string;
  metricKey: string;
  unit: string | null;
  cardinality: string;
  value: number | null;
  valueText: string | null;
  trustScore: number | null;
  minTrustScore: number | null;
  resolution: 'reported' | 'flagged' | 'gap';
  reasons: string[];
  datapointIds: string[];
  calculationIds: string[];
  evidence: EvidenceRef[];
}
interface DisclosureNode {
  code: string;
  title: string;
  guidance: string;
  status: string;
  datapoints: DatapointNode[];
  evidenceRequirements: Array<{ key: string; description: string; acceptableTypes: string[] }>;
}
interface RequirementNode {
  code: string;
  title: string;
  disclosures: DisclosureNode[];
}
interface RegulatoryFiling {
  formatVersion: string;
  organization: { legalName: string; country: string; baseCurrency: string };
  regulation: {
    key: string;
    name: string;
    jurisdiction: string;
    ruleStoreVersion: string;
    notice: string;
  };
  reportingPeriod: string;
  generatedAt: string;
  generatedBy: string | null;
  readiness: 'ready' | 'blocked';
  blockers: string[];
  stats: FilingStats;
  sections: RequirementNode[];
  gaps: FilingGap[];
  auditChainIntact: boolean;
  disclaimer: string;
  notice: string;
  digest: string;
}
type FilingDetail = FilingRow & { filing: RegulatoryFiling | null };

const RESOLUTION_COLOR: Record<string, string> = {
  reported: 'var(--positive)',
  flagged: 'var(--attention)',
  gap: 'var(--critical)',
};

export default async function FilingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await serverFetch<FilingDetail>(`/filings/${id}`);
  const row = res.data;

  if (res.error || !row) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <Link href="/compliance/filings" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Filings
        </Link>
        <p style={{ color: 'var(--critical)' }}>{res.error?.message ?? 'Filing not found.'}</p>
      </div>
    );
  }

  const f = row.filing;
  const ready = row.readiness === 'ready';

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900 }}>
      <div>
        <Link href="/compliance/filings" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Filings
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0 0' }}>
          {row.regulationKey} · {row.reportingPeriod} · v{row.version}
        </h1>
        <p className="mono muted" style={{ fontSize: 12, marginTop: 4 }}>
          {row.sha256} · {row.formatVersion} · {row.ruleStoreVersion}
        </p>
      </div>

      <section
        className="card"
        style={{
          borderLeft: `4px solid ${ready ? 'var(--positive)' : 'var(--critical)'}`,
        }}
        data-readiness={row.readiness}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ color: ready ? 'var(--positive)' : 'var(--critical)' }}>
              {ready ? 'Ready to file' : 'Do not file'}
            </strong>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              {ready
                ? 'All required datapoints are reported with acceptable evidence and the audit-log chain verifies.'
                : 'One or more required datapoints are missing, unverified or awaiting review, or the audit-log chain does not verify.'}
            </p>
          </div>
          <DownloadFiling filingId={row.id} />
        </div>
        <div
          className="muted"
          style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}
        >
          <span>{row.summary.stats.requiredDatapoints} required</span>
          <span style={{ color: 'var(--positive)' }}>{row.summary.stats.reported} reported</span>
          <span style={{ color: row.summary.stats.flagged ? 'var(--attention)' : undefined }}>
            {row.summary.stats.flagged} flagged
          </span>
          <span style={{ color: row.gapCount ? 'var(--critical)' : undefined }}>
            {row.gapCount} gaps
          </span>
          <span>{row.summary.stats.evidenceItems} evidence items</span>
          <span
            style={{
              color: f && !f.auditChainIntact ? 'var(--critical)' : 'var(--positive)',
            }}
          >
            audit chain {f ? (f.auditChainIntact ? 'intact' : 'BROKEN') : '—'}
          </span>
        </div>
        {row.summary.blockers.length > 0 && (
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {row.summary.blockers.map((b, i) => (
              <li key={i} style={{ color: 'var(--critical)' }}>
                {b}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!f && (
        <p className="notice">
          The stored document could not be loaded from object storage; the summary above is from the
          filing row.
        </p>
      )}

      {row.summary.gaps.length > 0 && (
        <section className="card">
          <div className="label">Gap report</div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Datapoint</th>
                <th>Disclosure</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {row.summary.gaps.map((g) => (
                <tr key={`${g.disclosureCode}/${g.datapointKey}`}>
                  <td>
                    <div>{g.label}</div>
                    <div className="mono muted" style={{ fontSize: 11 }}>
                      {g.datapointKey}
                    </div>
                  </td>
                  <td className="muted">
                    {g.requirementCode} · {g.disclosureCode}
                  </td>
                  <td>
                    <GapReasons reasons={g.reasons} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {f &&
        f.sections.map((req) => (
          <section key={req.code} className="card">
            <h2 style={{ fontSize: 15, margin: 0 }}>
              {req.code} — {req.title}
            </h2>
            {req.disclosures.map((dis) => (
              <div
                key={dis.code}
                style={{
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13 }}>
                    {dis.code} — {dis.title}
                  </strong>
                  <span className="tag" style={{ fontSize: 11 }}>
                    {dis.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {dis.guidance && (
                  <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                    {dis.guidance}
                  </p>
                )}
                <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                  {dis.datapoints.map((dp) => (
                    <div
                      key={dp.key}
                      style={{
                        borderLeft: `3px solid ${RESOLUTION_COLOR[dp.resolution]}`,
                        paddingLeft: 10,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          fontSize: 13,
                        }}
                      >
                        <span>
                          <strong>{dp.label}</strong>{' '}
                          <span className="mono muted" style={{ fontSize: 11 }}>
                            {dp.metricKey}
                          </span>
                        </span>
                        <span>
                          <strong>
                            {dp.value != null
                              ? `${dp.value}${dp.unit ? ` ${dp.unit}` : ''}`
                              : dp.valueText || '— not reported —'}
                          </strong>
                        </span>
                      </div>
                      <div
                        className="muted"
                        style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, marginTop: 3 }}
                      >
                        <span style={{ color: RESOLUTION_COLOR[dp.resolution] }}>
                          {dp.resolution}
                          {dp.reasons.length > 0 ? `: ${dp.reasons.join(', ')}` : ''}
                        </span>
                        <span>
                          trust {dp.trustScore ?? '—'}
                          {dp.minTrustScore != null ? ` / min ${dp.minTrustScore}` : ''}
                        </span>
                        {dp.datapointIds.length > 0 && (
                          <span>{dp.datapointIds.length} datapoint lineage</span>
                        )}
                        {dp.calculationIds.length > 0 && (
                          <span>{dp.calculationIds.length} calculation lineage</span>
                        )}
                      </div>
                      {dp.evidence.length > 0 && (
                        <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11 }}>
                          {dp.evidence.map((e) => (
                            <li key={e.id} className="muted">
                              {e.title} ({e.type}, {e.status}) ·{' '}
                              <span className="mono">{e.hash.slice(0, 12)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {dis.datapoints.length === 0 && (
                    <p className="muted" style={{ fontSize: 12 }}>
                      No required datapoints for this disclosure.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}

      {f && f.notice && <p className="notice" style={{ fontSize: 12 }}>{f.notice}</p>}
      <Disclaimer>{f?.disclaimer}</Disclaimer>
    </div>
  );
}
