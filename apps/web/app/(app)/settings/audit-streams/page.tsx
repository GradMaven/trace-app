import { serverFetch } from '@/lib/server-api';
import { AuditStreamsClient } from './audit-streams-client';

export const dynamic = 'force-dynamic';

export interface AuditStreamView {
  id: string;
  name: string;
  url: string;
  filters: { actionPrefixes?: string[]; resourceTypes?: string[] };
  status: string;
  cursor: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastError: string | null;
  createdAt: string;
}
export interface AuditStreamDeliveryView {
  id: string;
  streamId: string;
  count: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  responseStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

export default async function AuditStreamsPage() {
  const [streamsRes, deliveriesRes] = await Promise.all([
    serverFetch<AuditStreamView[]>('/settings/audit-streams'),
    serverFetch<AuditStreamDeliveryView[]>('/settings/audit-streams/deliveries?limit=50'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 940 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Audit Streams</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Forward every matching activity-log entry to your SIEM. The worker cursor-tails the log
          and POSTs signed JSON batches (<span className="mono">x-trace-signature</span>, same HMAC
          scheme as webhooks). A stream starts at the current log head — history is not back-filled.
          Failed batches retry with backoff; a stream that fails repeatedly is auto-paused.
        </p>
      </div>
      {streamsRes.error && <p style={{ color: 'var(--critical)' }}>{streamsRes.error.message}</p>}
      <AuditStreamsClient streams={streamsRes.data ?? []} deliveries={deliveriesRes.data ?? []} />
    </div>
  );
}
