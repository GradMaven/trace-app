'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { ApiKeyView } from './page';

interface Created {
  token: string;
  tokenPrefix: string;
  permissions: string[];
}

export function ApiKeysClient({
  keys,
  scopes,
}: {
  keys: ApiKeyView[];
  scopes: Array<{ scope: string; description: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await clientFetch<Created>('/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name,
        scopes: selected,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }),
    });
    setBusy(false);
    if (res.ok && res.data) {
      setCreated(res.data);
      setName('');
      setSelected([]);
      setExpiresAt('');
      router.refresh();
    } else {
      setErr(res.error?.message ?? 'Could not create the key.');
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this key? Calls using it will fail immediately.')) return;
    const res = await clientFetch(`/api-keys/${id}/revoke`, { method: 'POST' });
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not revoke.');
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {created && (
        <section className="card" style={{ borderColor: 'var(--positive)' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Copy your key now</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            This is the only time the full token is shown. Store it in your secret manager.
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
            {created.token}
          </pre>
          <p className="muted" style={{ fontSize: 12 }}>
            Grants: {created.permissions.join(', ')}
          </p>
          <button className="btn" onClick={() => setCreated(null)}>
            Done
          </button>
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Create a key</h2>
        <form onSubmit={create}>
          <div className="field">
            <label className="label">Name</label>
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI export job"
            />
          </div>
          <div className="field">
            <label className="label">Scopes</label>
            <div style={{ display: 'grid', gap: 6 }}>
              {scopes.map((s) => {
                const on = selected.includes(s.scope);
                return (
                  <label key={s.scope} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((v) => (on ? v.filter((x) => x !== s.scope) : [...v, s.scope]))
                      }
                    />
                    <span className="mono">{s.scope}</span>
                    <span className="muted">— {s.description}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="field">
            <label className="label">Expires (optional)</label>
            <input
              className="input"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !name || selected.length === 0}
          >
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </form>
      </section>

      <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '12px 14px' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Keys ({keys.length})</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th>State</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono muted">
                  trk_{k.tokenPrefix}…{k.last4}
                </td>
                <td>{k.scopes.join(', ')}</td>
                <td>
                  <span
                    className="tag"
                    style={{ color: k.state === 'active' ? 'var(--positive)' : 'var(--muted)' }}
                  >
                    {k.state}
                  </span>
                </td>
                <td className="muted">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {k.state === 'active' && (
                    <button className="btn" onClick={() => void revoke(k.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
