import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface OrgStats {
  organizationId: string;
  period: string;
  members: number;
  suppliers: number;
  datapoints: number;
  calculations: number;
  evidence: number;
  auditEntries: number;
  openFindings: number;
  webhookEndpoints: number;
  auditStreams: number;
  apiRequestsThisPeriod: number;
  aiJobsThisPeriod: number;
  worker: { status: string; ageSeconds: number | null };
}

const CARD: Array<{ key: keyof OrgStats; label: string }> = [
  { key: 'members', label: 'Active members' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'datapoints', label: 'Datapoints' },
  { key: 'calculations', label: 'Calculations' },
  { key: 'evidence', label: 'Evidence records' },
  { key: 'auditEntries', label: 'Audit-log entries' },
  { key: 'openFindings', label: 'Open findings' },
  { key: 'webhookEndpoints', label: 'Webhook endpoints' },
  { key: 'auditStreams', label: 'Audit streams' },
  { key: 'apiRequestsThisPeriod', label: 'API requests (period)' },
  { key: 'aiJobsThisPeriod', label: 'AI jobs (period)' },
];

const WORKER_COLOR: Record<string, string> = {
  up: 'var(--positive)',
  degraded: 'var(--warning, #b7791f)',
  down: 'var(--critical)',
};

export default async function OpsPage() {
  const res = await serverFetch<OrgStats>('/ops/stats');
  const s = res.data;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Ops &amp; Health</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          A snapshot of this organization plus the background-worker heartbeat. Process-wide
          Prometheus metrics are at <span className="mono">/api/v1/metrics</span> (Bearer{' '}
          <span className="mono">METRICS_TOKEN</span>); detailed health is at{' '}
          <span className="mono">/api/v1/health/detailed</span>.
        </p>
      </div>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      {s && (
        <>
          <section className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <strong>Background worker</strong>
            <span className="tag" style={{ color: WORKER_COLOR[s.worker.status] }}>
              {s.worker.status}
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              {s.worker.ageSeconds == null
                ? 'no heartbeat recorded'
                : `last beat ${s.worker.ageSeconds}s ago`}
            </span>
          </section>

          <section
            className="card"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
              gap: 12,
            }}
          >
            {CARD.map((c) => (
              <div key={c.key}>
                <div className="label">{c.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {Number(s[c.key]).toLocaleString()}
                </div>
              </div>
            ))}
          </section>
          <p className="muted" style={{ fontSize: 12 }}>
            Billing period {s.period}.
          </p>
        </>
      )}
    </div>
  );
}
