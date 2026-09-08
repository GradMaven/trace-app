import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { RunScanButton } from './run-scan';

export const dynamic = 'force-dynamic';

interface Summary {
  reportingPeriod: string | null;
  datapoints: number;
  scored: number;
  avgTrustScore: number | null;
  bands: { high: number; medium: number; low: number };
  openIssues: { critical: number; warning: number; info: number; total: number };
  openAnomalies: number;
  lastScan: {
    id: string;
    startedAt: string;
    completedAt: string | null;
    datapointsScored: number;
    avgTrustScore: string | null;
    issuesOpen: number;
    anomaliesFound: number;
  } | null;
}

interface Scan {
  id: string;
  reportingPeriod: string | null;
  datapointsScored: number;
  avgTrustScore: string | null;
  issuesOpened: number;
  issuesResolved: number;
  issuesOpen: number;
  anomaliesFound: number;
  modelVersion: string;
  rulesVersion: string;
  detectorVersion: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="card" style={{ minWidth: 130 }}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

export default async function DataQualityPage() {
  const [summaryRes, scansRes] = await Promise.all([
    serverFetch<Summary>('/data-quality/summary'),
    serverFetch<Scan[]>('/data-quality/scans?limit=10'),
  ]);
  const s = summaryRes.data;
  const scans = scansRes.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Data Quality</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            How trustworthy every major datapoint is — the TRACE Trust Score, plus the data-quality
            issues and anomalies behind it.
          </p>
        </div>
        <RunScanButton />
      </div>

      {summaryRes.error && <p style={{ color: 'var(--critical)' }}>{summaryRes.error.message}</p>}

      {s && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat
              label="Avg Trust Score"
              value={s.avgTrustScore ?? '—'}
              color={
                s.avgTrustScore == null
                  ? undefined
                  : s.avgTrustScore >= 75
                    ? 'var(--positive)'
                    : s.avgTrustScore >= 50
                      ? 'var(--attention)'
                      : 'var(--critical)'
              }
            />
            <Stat label="Datapoints scored" value={`${s.scored} / ${s.datapoints}`} />
            <Stat
              label="High / Med / Low"
              value={`${s.bands.high} · ${s.bands.medium} · ${s.bands.low}`}
            />
            <Stat
              label="Open issues"
              value={s.openIssues.total}
              color={s.openIssues.critical > 0 ? 'var(--critical)' : undefined}
            />
            <Stat label="Open anomalies" value={s.openAnomalies} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: '1 1 260px' }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>Open issues by severity</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  <span className="tag" style={{ color: 'var(--critical)' }}>
                    critical
                  </span>{' '}
                  {s.openIssues.critical}
                </li>
                <li>
                  <span className="tag" style={{ color: 'var(--attention)' }}>
                    warning
                  </span>{' '}
                  {s.openIssues.warning}
                </li>
                <li>
                  <span className="tag">info</span> {s.openIssues.info}
                </li>
              </ul>
              <Link href="/data/quality/issues" style={{ color: 'var(--accent)', fontSize: 13 }}>
                Triage issues →
              </Link>
            </div>
            <div className="card" style={{ flex: '1 1 260px' }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>Anomalies</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                {s.openAnomalies} open. Deterministic detectors (modified z-score,
                period-over-period change) — a human confirms or dismisses each.
              </p>
              <Link href="/data/quality/anomalies" style={{ color: 'var(--accent)', fontSize: 13 }}>
                Review anomalies →
              </Link>
            </div>
          </div>

          {s.lastScan ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              Last scan {new Date(s.lastScan.startedAt).toLocaleString()} — scored{' '}
              {s.lastScan.datapointsScored} datapoints, {s.lastScan.issuesOpen} issues open,{' '}
              {s.lastScan.anomaliesFound} anomalies found.
            </p>
          ) : (
            <p className="notice">
              No scan has run yet. Run one to score datapoints and surface issues.
            </p>
          )}
        </>
      )}

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Period</th>
              <th>Scored</th>
              <th>Avg score</th>
              <th>Opened</th>
              <th>Resolved</th>
              <th>Open</th>
              <th>Anomalies</th>
              <th>Versions</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((sc) => (
              <tr key={sc.id}>
                <td className="muted">{new Date(sc.startedAt).toLocaleString()}</td>
                <td>{sc.reportingPeriod ?? 'all'}</td>
                <td>{sc.datapointsScored}</td>
                <td>{sc.avgTrustScore ?? '—'}</td>
                <td>{sc.issuesOpened}</td>
                <td>{sc.issuesResolved}</td>
                <td>{sc.issuesOpen}</td>
                <td>{sc.anomaliesFound}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>
                  {sc.modelVersion} · {sc.rulesVersion} · {sc.detectorVersion}
                </td>
                <td className="muted">{sc.durationMs} ms</td>
              </tr>
            ))}
            {scans.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  No scans yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
