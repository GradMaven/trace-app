'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { WebhookEndpointView } from './page';

export function WebhooksClient({
  endpoints,
  events,
}: {
  endpoints: WebhookEndpointView[];
  events: Array<{ event: string; description: string }>;
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function testFire(id: string) {
    const res = await clientFetch(`/webhooks/${id}/test`, { method: 'POST' });
    if (res.ok) {
      setNote('Test event queued — check the delivery log in a few seconds.');
      router.refresh();
    } else {
      setErr(res.error?.message ?? 'Could not send a test event.');
    }
  }

  function toggle(ev: string) {
    setSelected((v) => (v.includes(ev) ? v.filter((x) => x !== ev) : [...v, ev]));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await clientFetch<{ id: string; secret: string }>('/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url, description: description || undefined, events: selected }),
    });
    setBusy(false);
    if (res.ok && res.data) {
      setSecret(res.data.secret);
      setUrl('');
      setDescription('');
      setSelected([]);
      router.refresh();
    } else {
      setErr(res.error?.message ?? 'Could not create the endpoint.');
    }
  }

  async function act(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    const res = await clientFetch(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.ok) {
      router.refresh();
      return true;
    }
    setErr(res.error?.message ?? 'Request failed.');
    return false;
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {secret && (
        <section className="card" style={{ borderColor: 'var(--positive)' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Signing secret</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Shown once. Configure your receiver to verify <span className="mono">x-trace-signature</span> with it.
          </p>
          <pre
            className="mono"
            style={{ background: 'var(--bg-subtle)', padding: 12, borderRadius: 6, overflowX: 'auto', userSelect: 'all' }}
          >
            {secret}
          </pre>
          <button className="btn" onClick={() => setSecret(null)}>
            Done
          </button>
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Add an endpoint</h2>
        <form onSubmit={create}>
          <div className="field">
            <label className="label">Payload URL (https)</label>
            <input
              className="input"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hooks/trace"
            />
          </div>
          <div className="field">
            <label className="label">Description (optional)</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Events</label>
            <div style={{ display: 'grid', gap: 6 }}>
              {events.map((ev) => (
                <label key={ev.event} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
                  <input type="checkbox" checked={selected.includes(ev.event)} onChange={() => toggle(ev.event)} />
                  <span className="mono">{ev.event}</span>
                  <span className="muted">— {ev.description}</span>
                </label>
              ))}
            </div>
          </div>
          {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !url || selected.length === 0}>
            {busy ? 'Creating…' : 'Add endpoint'}
          </button>
        </form>
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Endpoints ({endpoints.length})</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>URL</th>
              <th>Events</th>
              <th>Status</th>
              <th>Last result</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ fontSize: 12, maxWidth: 260, overflowWrap: 'anywhere' }}>
                  {e.url}
                  {e.description && <div className="muted">{e.description}</div>}
                </td>
                <td style={{ fontSize: 12 }}>{e.events.join(', ')}</td>
                <td>
                  <span
                    className="tag"
                    style={{
                      color:
                        e.status === 'active'
                          ? 'var(--positive)'
                          : e.status === 'disabled'
                            ? 'var(--critical)'
                            : 'var(--muted)',
                    }}
                  >
                    {e.status}
                  </span>
                  {e.consecutiveFailures > 0 && (
                    <span className="muted" style={{ fontSize: 11 }}> · {e.consecutiveFailures} fails</span>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {e.lastSuccessAt
                    ? `ok ${new Date(e.lastSuccessAt).toLocaleString()}`
                    : e.lastFailureAt
                      ? `fail ${new Date(e.lastFailureAt).toLocaleString()}`
                      : 'never fired'}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn" onClick={() => void testFire(e.id)}>
                    Test
                  </button>{' '}
                  {e.status === 'active' ? (
                    <button className="btn" onClick={() => void act(`/webhooks/${e.id}`, 'PATCH', { status: 'paused' })}>
                      Pause
                    </button>
                  ) : (
                    <button className="btn" onClick={() => void act(`/webhooks/${e.id}`, 'PATCH', { status: 'active' })}>
                      Resume
                    </button>
                  )}{' '}
                  <button
                    className="btn"
                    onClick={() => {
                      if (confirm('Delete this endpoint and its delivery history?'))
                        void act(`/webhooks/${e.id}`, 'DELETE');
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {endpoints.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No endpoints configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {note && <p style={{ color: 'var(--positive)', fontSize: 13 }}>{note}</p>}
    </div>
  );
}
