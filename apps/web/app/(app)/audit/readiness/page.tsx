import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { ScoreBadge } from '@/components/audit-bits';
import { ReadinessActions } from './readiness-actions';

export const dynamic = 'force-dynamic';

interface Contribution {
  dimension: string;
  max: number;
  awarded: number;
  rationale: string;
}

interface Readiness {
  latestSimulation: {
    id: string;
    reportingPeriod: string | null;
    ruleStoreVersion: string | null;
    readinessValue: number;
    readinessBand: string;
    modelVersion: string;
    breakdown: Contribution[];
    issueCounts: Record<string, number>;
    startedAt: string;
    completedAt: string | null;
  } | null;
  openFindings: { critical: number; warning: number; info: number; total: number };
  packages: Array<{
    id: string;
    status: string;
    reportingPeriod: string | null;
    contentDigest: string;
    sizeBytes: number | null;
    readinessValue: number | null;
    generatedAt: string | null;
    createdAt: string;
  }>;
}

interface AuditRow {
  id: string;
  name: string;
  status: string;
  reportingPeriod: string | null;
  externalAuditor: string | null;
  findingCount: number;
  createdAt: string;
}

export default async function AuditReadinessPage() {
  const [readinessRes, auditsRes] = await Promise.all([
    serverFetch<Readiness>('/audit/readiness'),
    serverFetch<AuditRow[]>('/audit/audits'),
  ]);
  const r = readinessRes.data;
  const audits = auditsRes.data ?? [];
  const sim = r?.latestSimulation ?? null;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
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
          <h1 style={{ fontSize: 20, margin: 0 }}>Audit — Readiness</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            How defensible the reported numbers are right now — evidence, reproducibility,
            approvals, data quality, Trust, compliance mapping and the audit trail. Indicative, not
            an assurance opinion.
          </p>
        </div>
        <ReadinessActions />
      </div>

      {readinessRes.error && (
        <p style={{ color: 'var(--critical)' }}>{readinessRes.error.message}</p>
      )}

      {!sim ? (
        <p className="notice">
          No readiness simulation has run yet. Run one to score the workspace.
        </p>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <ScoreBadge value={sim.readinessValue} band={sim.readinessBand} />
            <span className="mono muted" style={{ fontSize: 12 }}>
              {sim.modelVersion}
              {sim.ruleStoreVersion ? ` · ${sim.ruleStoreVersion}` : ''}
              {sim.reportingPeriod ? ` · ${sim.reportingPeriod}` : ''}
            </span>
            <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {new Date(sim.startedAt).toLocaleString()}
            </span>
          </div>
          <table style={{ width: '100%', marginTop: 12 }}>
            <thead>
              <tr>
                <th>Dimension</th>
                <th style={{ width: 90 }}>Awarded</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {sim.breakdown.map((c) => (
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
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 240px' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Open findings</h2>
          <p style={{ fontSize: 22, fontWeight: 600, margin: '4px 0' }}>
            {r?.openFindings.total ?? 0}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            <span style={{ color: 'var(--critical)' }}>
              {r?.openFindings.critical ?? 0} critical
            </span>{' '}
            ·{' '}
            <span style={{ color: 'var(--attention)' }}>
              {r?.openFindings.warning ?? 0} warning
            </span>{' '}
            · {r?.openFindings.info ?? 0} info
          </p>
          <Link href="/audit/findings" style={{ color: 'var(--accent)', fontSize: 13 }}>
            Triage findings →
          </Link>
        </div>
        <div className="card" style={{ flex: '1 1 240px' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Latest audit packages</h2>
          {(r?.packages ?? []).length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              None generated yet.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(r?.packages ?? []).slice(0, 3).map((p) => (
                <li key={p.id}>
                  <span className="tag">{p.status}</span>{' '}
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {p.contentDigest.slice(0, 12)}
                  </span>{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {p.generatedAt ? new Date(p.generatedAt).toLocaleDateString() : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/audit/packages" style={{ color: 'var(--accent)', fontSize: 13 }}>
            All packages →
          </Link>
        </div>
      </div>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Audit engagements</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Period</th>
              <th>External auditor</th>
              <th>Status</th>
              <th>Findings</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="muted">{a.reportingPeriod ?? '—'}</td>
                <td className="muted">{a.externalAuditor ?? '—'}</td>
                <td>
                  <span className="tag">{a.status}</span>
                </td>
                <td>{a.findingCount}</td>
                <td className="muted">{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {audits.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No audit engagements yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
