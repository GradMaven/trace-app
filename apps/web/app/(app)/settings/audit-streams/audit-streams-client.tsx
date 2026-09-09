'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { AuditStreamDeliveryView, AuditStreamView } from './page';

const COLOR: Record<string, string> = {
  succeeded: 'var(--positive)',
  active: 'var(--positive)',
  pending: 'var(--muted)',
  delivering: 'var(--muted)',
  failed: 'var(--critical)',
  dead: 'var(--critical)',
  paused: 'var(--muted)',
  error: 'var(--critical)',
};

export function AuditStreamsClient({
  streams,
  deliveries,
}: {
  streams: AuditStreamView[];
  deliveries: AuditStreamDeliveryView[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [prefixes, setPrefixes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const actionPrefixes = prefixes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await clientFetch<{ id: string; secret: string }>('/settings/audit-streams', {
      method: 'POST',
      body: JSON.stringify({
        name,
        url,
        filters: actionPrefixes.length ? { actionPrefixes } : undefined,
      }),
    });
    setBusy(false);
    if (res.ok && res.data) {
      setSecret(res.data.secret);
      setName('');
      setUrl('');
      setPrefixes('');
      router.refresh();
    } else {
      setErr(res.error?.message ?? 'Could not create the stream.');
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

  async function test(id: string) {
    const res = await clientFetch(`/settings/audit-streams/${id}/test`, { method: 'POST' });
    if (res.ok) {
      setNote('Ping batch queued — check the deliveries below shortly.');
      router.refresh();
    } else setErr(res.error?.message ?? 'Could not send a test batch.');
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {secret && (
        <section className="card" style={{ borderColor: 'var(--positive)' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Signing secret</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Shown once. Verify <span className="mono">x-trace-signature</span> with it.
          </p>
          <pre
            className="mono"
            style={{
              background: 'var(--bg-subtle)',
              padding: 12,
              borderRadius: 6,
              overflowX: 'auto',
              userSelect: 'all',
            }}
          >
            {secret}
          </pre>
          <button className="btn" onClick={() => setSecret(null)}>
            Done
          </button>
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Add a stream</h2>
        <form onSubmit={create}>
          <div className="field">
            <label className="label">Name</label>
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Endpoint URL (https)</label>
            <input
              className="input"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://siem.example.com/ingest/trace"
            />
          </div>
          <div className="field">
            <label className="label">Action prefixes (comma-separated, blank = everything)</label>
            <input
              className="input mono"
              value={prefixes}
              onChange={(e) => setPrefixes(e.target.value)}
              placeholder="evidence., compliance., audit."
            />
          </div>
          {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !name || !url}>
            {busy ? 'Creating…' : 'Add stream'}
          </button>
        </form>
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Streams ({streams.length})</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name / URL</th>
              <th>Filter</th>
              <th>Status</th>
              <th>Last delivery</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {streams.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  <div className="mono muted" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>
                    {s.url}
                  </div>
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {s.filters.actionPrefixes?.join(' ') ?? 'all'}
                </td>
                <td>
                  <span className="tag" style={{ color: COLOR[s.status] }}>
                    {s.status}
                  </span>
                  {s.consecutiveFailures > 0 && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {' '}
                      · {s.consecutiveFailures} fails
                    </span>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {s.lastDeliveryAt ? new Date(s.lastDeliveryAt).toLocaleString() : 'never'}
                  {s.lastError && (
                    <div style={{ color: 'var(--critical)' }}>{s.lastError.slice(0, 60)}</div>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn" onClick={() => void test(s.id)}>
                    Test
                  </button>{' '}
                  {s.status === 'active' ? (
                    <button
                      className="btn"
                      onClick={() =>
                        void act(`/settings/audit-streams/${s.id}`, 'PATCH', { status: 'paused' })
                      }
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      className="btn"
                      onClick={() =>
                        void act(`/settings/audit-streams/${s.id}`, 'PATCH', { status: 'active' })
                      }
                    >
                      Resume
                    </button>
                  )}{' '}
                  <button
                    className="btn"
                    onClick={() => {
                      if (confirm('Delete this stream and its delivery history?'))
                        void act(`/settings/audit-streams/${s.id}`, 'DELETE');
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {streams.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No streams configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {note && <p style={{ color: 'var(--positive)', fontSize: 13 }}>{note}</p>}

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Recent deliveries</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th style={{ textAlign: 'right' }}>Entries</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Response</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td className="muted">{new Date(d.createdAt).toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{d.count}</td>
                <td>
                  <span className="tag" style={{ color: COLOR[d.status] }}>
                    {d.status}
                  </span>
                </td>
                <td>
                  {d.attempts}/{d.maxAttempts}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {d.responseStatus ?? d.error ?? '—'}
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
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
