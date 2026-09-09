'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { IdentityProviderView } from './page';

interface Config {
  provider: IdentityProviderView | null;
  orgSlug: string;
  redirectUri: string;
  startUrl: string;
}

export function SsoClient({
  config,
  roles,
}: {
  config: Config;
  roles: Array<{ key: string; name: string }>;
}) {
  const router = useRouter();
  const p = config.provider;
  const [form, setForm] = useState({
    enabled: p?.enabled ?? false,
    issuer: p?.issuer ?? '',
    clientId: p?.clientId ?? '',
    clientSecret: '',
    authorizationEndpoint: p?.authorizationEndpoint ?? '',
    tokenEndpoint: p?.tokenEndpoint ?? '',
    jwksUri: p?.jwksUri ?? '',
    scopes: p?.scopes ?? 'openid email profile',
  });
  const [defaultRoles, setDefaultRoles] = useState<string[]>(
    p?.roleMapping.defaultRoles ?? ['esg_analyst'],
  );
  const [groupClaim, setGroupClaim] = useState(p?.roleMapping.groupClaim ?? 'groups');
  const [groupRolesText, setGroupRolesText] = useState(
    JSON.stringify(p?.roleMapping.groupRoles ?? {}, null, 0),
  );
  const [emailDomainRolesText, setEmailDomainRolesText] = useState(
    JSON.stringify(p?.roleMapping.emailDomainRoles ?? {}, null, 0),
  );
  const [allowedDomains, setAllowedDomains] = useState((p?.allowedEmailDomains ?? []).join(', '));
  const [busy, setBusy] = useState<null | 'save' | 'discover' | 'delete'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function discover() {
    setBusy('discover');
    setErr(null);
    const res = await clientFetch<{
      authorizationEndpoint: string;
      tokenEndpoint: string;
      jwksUri: string;
      issuer: string;
    }>('/settings/sso/discover', { method: 'POST', body: JSON.stringify({ issuer: form.issuer }) });
    setBusy(null);
    if (res.ok && res.data) {
      setForm((f) => ({
        ...f,
        issuer: res.data!.issuer || f.issuer,
        authorizationEndpoint: res.data!.authorizationEndpoint,
        tokenEndpoint: res.data!.tokenEndpoint,
        jwksUri: res.data!.jwksUri,
      }));
      setNote('Endpoints filled from the discovery document.');
    } else {
      setErr(res.error?.message ?? 'Discovery failed.');
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setErr(null);
    let emailDomainRoles: Record<string, string[]> = {};
    let groupRoles: Record<string, string[]> = {};
    try {
      emailDomainRoles = emailDomainRolesText.trim() ? JSON.parse(emailDomainRolesText) : {};
      groupRoles = groupRolesText.trim() ? JSON.parse(groupRolesText) : {};
    } catch {
      setBusy(null);
      setErr('Email-domain roles and group roles must be valid JSON objects.');
      return;
    }
    const { clientSecret, ...rest } = form;
    const body = {
      ...rest,
      // Omit to keep the stored secret on an update.
      ...(clientSecret ? { clientSecret } : {}),
      roleMapping: { defaultRoles, groupClaim, emailDomainRoles, groupRoles },
      allowedEmailDomains: allowedDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
    };
    if (!clientSecret && !p) {
      setBusy(null);
      setErr('Client secret is required.');
      return;
    }
    const res = await clientFetch('/settings/sso', { method: 'PUT', body: JSON.stringify(body) });
    setBusy(null);
    if (res.ok) {
      setForm((f) => ({ ...f, clientSecret: '' }));
      router.refresh();
      setNote('Saved.');
    } else {
      setErr(res.error?.message ?? 'Could not save.');
    }
  }

  async function remove() {
    if (!confirm('Remove the identity provider? Members will fall back to email sign-in.')) return;
    setBusy('delete');
    const res = await clientFetch('/settings/sso', { method: 'DELETE' });
    setBusy(null);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not remove.');
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="card">
        <div className="label">Redirect URI (register this at your IdP)</div>
        <code
          style={{
            display: 'block',
            background: 'var(--bg-subtle)',
            padding: 10,
            borderRadius: 6,
            userSelect: 'all',
            wordBreak: 'break-all',
          }}
        >
          {config.redirectUri}
        </code>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Members start SSO at <span className="mono">{config.startUrl}</span> (or via the
          &quot;Continue with SSO&quot; box on the login page using{' '}
          <span className="mono">{config.orgSlug}</span>).
          {p && (
            <>
              {' '}
              · <strong>{p.linkedMembers}</strong> member(s) linked.
            </>
          )}
        </p>
      </section>

      <form className="card" onSubmit={save}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          <strong>Enable OIDC sign-in for this workspace</strong>
        </label>

        <div className="field">
          <label className="label">Issuer</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              required
              value={form.issuer}
              onChange={(e) => set('issuer', e.target.value)}
              placeholder="https://idp.example.com"
            />
            <button
              type="button"
              className="btn"
              onClick={() => void discover()}
              disabled={busy !== null || !form.issuer}
            >
              {busy === 'discover' ? '…' : 'Discover'}
            </button>
          </div>
        </div>
        {(['authorizationEndpoint', 'tokenEndpoint', 'jwksUri'] as const).map((k) => (
          <div className="field" key={k}>
            <label className="label">{k}</label>
            <input
              className="input mono"
              required
              value={form[k]}
              onChange={(e) => set(k, e.target.value)}
            />
          </div>
        ))}
        <div className="field">
          <label className="label">Client ID</label>
          <input
            className="input"
            required
            value={form.clientId}
            onChange={(e) => set('clientId', e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">
            Client secret{' '}
            {p && <span className="muted">(leave blank to keep the current one)</span>}
          </label>
          <input
            className="input"
            type="password"
            value={form.clientSecret}
            onChange={(e) => set('clientSecret', e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">Scopes</label>
          <input
            className="input mono"
            value={form.scopes}
            onChange={(e) => set('scopes', e.target.value)}
          />
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
        <div className="label">Role mapping (JIT provisioning)</div>
        <div className="field">
          <label className="label">Default roles (every SSO member)</label>
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
          <label className="label">Group claim</label>
          <input
            className="input mono"
            value={groupClaim}
            onChange={(e) => setGroupClaim(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">
            Group → roles (JSON, e.g. {'{"trace-admins":["organization_admin"]}'})
          </label>
          <input
            className="input mono"
            value={groupRolesText}
            onChange={(e) => setGroupRolesText(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">Email domain → roles (JSON)</label>
          <input
            className="input mono"
            value={emailDomainRolesText}
            onChange={(e) => setEmailDomainRolesText(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">Allowed email domains (comma-separated, blank = any)</label>
          <input
            className="input mono"
            value={allowedDomains}
            onChange={(e) => setAllowedDomains(e.target.value)}
          />
        </div>

        {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
        {note && <p style={{ color: 'var(--positive)', fontSize: 13 }}>{note}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy !== null || defaultRoles.length === 0}
          >
            {busy === 'save' ? 'Saving…' : p ? 'Save changes' : 'Configure OIDC'}
          </button>
          {p && (
            <button
              className="btn"
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
            >
              Remove provider
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
