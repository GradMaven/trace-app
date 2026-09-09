import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { DeliveriesClient } from './deliveries-client';

export const dynamic = 'force-dynamic';

export interface WebhookDeliveryView {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  payload: unknown;
  createdAt: string;
}

export default async function DeliveriesPage() {
  const res = await serverFetch<WebhookDeliveryView[]>('/webhooks/deliveries?limit=100');

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1000 }}>
      <div>
        <Link href="/settings/webhooks" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Webhooks
        </Link>
        <h1 style={{ fontSize: 20, margin: '6px 0 0' }}>Webhook deliveries</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          The 100 most recent delivery attempts across every endpoint. A{' '}
          <span className="mono">failed</span> or <span className="mono">dead</span> delivery
          can be re-queued.
        </p>
      </div>
      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}
      <DeliveriesClient deliveries={res.data ?? []} />
    </div>
  );
}
