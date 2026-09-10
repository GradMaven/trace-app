'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { ScimConfigView, ScimOverview } from './page';

interface Data {
  config: ScimConfigView | null;
  baseUrl: string;
  overview: ScimOverview;
}

export function ScimClient({
  data,
  roles,
}: {
  data: Data;
  roles: Array<{ key: string; name: string }>;
}) {
  const router = useRouter();
  const c = data.config;
  const [enabled, setEnabled] = useState(c?.enabled ?? false);
  const [defaultRoles, setDefaultRoles] = useState<string[]>(c?.defaultRoles ?? ['esg_analyst']);
  const [groupMapText, setGroupMapText] = useState(
    JSON.stringify(c?.groupRoleMapping ?? {}, null, 0),
  );
  const [busy, setBusy] = useState<null | 'save' | 'token' | 'delete'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setErr(null);
    setNote(null);
    let groupRoleMapping: Record<string, string[]> = {};
    try {
      groupRoleMapping = groupMapText.trim() ? JSON.parse(groupMapText) : {};
    } catch {
      setBusy(null);
      setErr('Group → roles must be a valid JSON object.');
      return;
    }
    const res = await clientFetch('/settings/scim', {
      method: 'PUT',
      body: JSON.stringify({ enabled, defaultRoles, groupRoleMapping }),
    });
    setBusy(null);
    if (res.ok) {
      router.refresh();
      setNote('Saved.');
    } else {
      setErr(res.error?.message ?? 'Could not save.');
    }
  }

  async function rotate() {
    setBusy('token');
    setErr(null);
    const res = await clientFetch<{ token: string }>('/settings/scim/token', { method: 'POST' });
    setBusy(null);
    if (res.ok && res.data) {
      setFreshToken(res.data.token);
      router.refresh();
    } else {
      setErr(res.error?.message ?? 'Could not issue a token.');
    }
  }

  async function remove() {
    if (!confirm('Remove the SCIM connection? Provisioned members are kept; the token stops working.'))
      return;
    setBusy('delete');
    const res = await clientFetch('/settings/scim', { method: 'DELETE' });
    setBusy(null);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not remove.');
  }

  const code = {
    display: 'block',
    background: 'var(--bg-subtle)',
    padding: 10,
    borderRadius: 6,
    userSelect: 'all' as const,
    wordBreak: 'break-all' as const,
    fontSize: 12,
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card">
        <div className="label">Configure these at your identity provider</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              SCIM base URL
            </div>
            <code style={code}>{data.baseUrl}</code>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Bearer token
            </div>
            {freshToken ? (
              <code style={{ ...code, color: 'var(--positive)' }}>{freshToken}</code>
            ) : (
              <p className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
                {c?.hasToken
                  ? `A token is set (${c.tokenPrefix}…). Issue a new one to rotate — the old one stops working immediately.`
                  : 'No token yet. Issue one below.'}
              </p>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void rotate()}
              disabled={busy !== null}
              style={{ marginTop: 6 }}
            >
              {busy === 'token' ? 'Issuing…' : c?.hasToken ? 'Rotate token' : 'Issue token'}
            </button>
            {freshToken && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Copy this now — it is shown once.
              </p>
            )}
          </div>
        </div>
        {c && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <strong>{c.userCount}</strong> user(s), <strong>{c.groupCount}</strong> group(s)
            provisioned
            {c.lastRequestAt ? ` · last request ${new Date(c.lastRequestAt).toLocaleString()}` : ''}.
          </p>
        )}
      </section>

      <form className="card" onSubmit={save}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 12 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <strong>Accept SCIM requests for this workspace</strong>
        </label>

        <div className="field">
          <label className="label">Default roles (every provisioned member)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {roles.map((r) => {
              const on = defaultRoles.includes(r.key);
              return (
                <button
                  type="button"
                  key={r.key}
                  className="tag"
                  onClick={() =>
                    setDefaultRoles((v) => (on ? v.filter((k) => k !== r.key) : [...v, r.key]))
                  }
                  style={{
                    cursor: 'pointer',
                    background: on ? 'var(--accent)' : 'transparent',
                    color: on ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  {r.key}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label className="label">
            Group → roles (JSON keyed on the SCIM group displayName or externalId, e.g.{' '}
            {'{"TRACE Admins":["organization_admin"]}'})
          </label>
          <input
            className="input mono"
            value={groupMapText}
            onChange={(e) => setGroupMapText(e.target.value)}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            SCIM only ever adds or removes roles in this managed set — roles you assign by hand are
            left alone.
          </p>
        </div>

        {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
        {note && <p style={{ color: 'var(--positive)', fontSize: 13 }}>{note}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy !== null || defaultRoles.length === 0}
          >
            {busy === 'save' ? 'Saving…' : c ? 'Save changes' : 'Configure SCIM'}
          </button>
          {c && (
            <button
              className="btn"
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
            >
              Remove connection
            </button>
          )}
        </div>
      </form>

      {c && (data.overview.users.length > 0 || data.overview.groups.length > 0) && (
        <section className="card" style={{ display: 'grid', gap: 14 }}>
          <div>
            <div className="label">Provisioned users</div>
            {data.overview.users.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>None yet.</p>
            ) : (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '4px 6px' }}>userName</th>
                    <th style={{ padding: '4px 6px' }}>status</th>
                    <th style={{ padding: '4px 6px' }}>roles</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overview.users.map((u) => (
                    <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 6px' }}>{u.userName}</td>
                      <td style={{ padding: '4px 6px' }}>
                        <span style={{ color: u.active ? 'var(--positive)' : 'var(--text-secondary)' }}>
                          {u.active ? 'active' : 'suspended'}
                        </span>
                      </td>
                      <td style={{ padding: '4px 6px' }} className="mono">
                        {u.roleKeys.join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <div className="label">Provisioned groups</div>
            {data.overview.groups.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>None yet.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {data.overview.groups.map((g) => (
                  <li key={g.id}>
                    <strong>{g.displayName}</strong> — {g.memberCount} member(s)
                    {g.externalId ? ` · ${g.externalId}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
