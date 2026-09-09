'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { WebhookDeliveryView } from './page';

const COLOR: Record<string, string> = {
  succeeded: 'var(--positive)',
  pending: 'var(--muted)',
  delivering: 'var(--muted)',
  failed: 'var(--critical)',
  dead: 'var(--critical)',
};

export function DeliveriesClient({ deliveries }: { deliveries: WebhookDeliveryView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function retry(id: string) {
    const res = await clientFetch(`/webhooks/deliveries/${id}/retry`, { method: 'POST' });
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not re-queue.');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <p style={{ color: 'var(--critical)' }}>{err}</p>}
      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Response</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <Fragment key={d.id}>
                <tr>
                  <td className="muted">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{d.event}</td>
                  <td>
                    <span className="tag" style={{ color: COLOR[d.status] ?? undefined }}>
                      {d.status}
                    </span>
                  </td>
                  <td>
                    {d.attempts}/{d.maxAttempts}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {d.responseStatus ?? d.error ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn" onClick={() => setOpen(open === d.id ? null : d.id)}>
                      {open === d.id ? 'Hide' : 'Payload'}
                    </button>{' '}
                    {(d.status === 'failed' || d.status === 'dead') && (
                      <button className="btn" onClick={() => void retry(d.id)}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
                {open === d.id && (
                  <tr>
                    <td colSpan={6}>
                      <pre
                        className="mono"
                        style={{
                          background: 'var(--bg-subtle)',
                          padding: 12,
                          borderRadius: 6,
                          overflowX: 'auto',
                          fontSize: 12,
                        }}
                      >
                        {JSON.stringify(d.payload, null, 2)}
                      </pre>
                      {d.responseBody && (
                        <pre
                          className="mono"
                          style={{ background: 'var(--bg-subtle)', padding: 12, borderRadius: 6, overflowX: 'auto', fontSize: 12 }}
                        >
                          {d.responseBody}
                        </pre>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No deliveries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
