import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { WebhooksClient } from './webhooks-client';

export const dynamic = 'force-dynamic';

export interface WebhookEndpointView {
  id: string;
  url: string;
  description: string;
  events: string[];
  status: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
}

export default async function WebhooksPage() {
  const [endpointsRes, eventsRes] = await Promise.all([
    serverFetch<WebhookEndpointView[]>('/webhooks'),
    serverFetch<Array<{ event: string; description: string }>>('/webhooks/events'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 920 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Webhooks</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            TRACE POSTs a signed JSON event to your endpoint whenever a matching change is
            recorded in the audit log. Every request carries an{' '}
            <span className="mono">x-trace-signature</span> header (HMAC-SHA256 of{' '}
            <span className="mono">timestamp.body</span>); verify it with the endpoint&apos;s
            signing secret. Failed deliveries retry with exponential backoff.
          </p>
        </div>
        <Link href="/settings/webhooks/deliveries" className="btn">
          Delivery log →
        </Link>
      </div>
      {endpointsRes.error && <p style={{ color: 'var(--critical)' }}>{endpointsRes.error.message}</p>}
      <WebhooksClient endpoints={endpointsRes.data ?? []} events={eventsRes.data ?? []} />
    </div>
  );
}
