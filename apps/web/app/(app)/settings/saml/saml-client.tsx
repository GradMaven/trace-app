'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { SamlProviderView } from './page';

interface Config {
  provider: SamlProviderView | null;
  orgSlug: string;
  acsUrl: string;
  startUrl: string;
  spEntityId: string;
  metadataUrl: string;
}

function splitCertificates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.includes('BEGIN CERTIFICATE')) {
    return trimmed
      .split(/(?=-----BEGIN CERTIFICATE-----)/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [trimmed];
}

export function SamlClient({
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
    idpEntityId: p?.idpEntityId ?? '',
    ssoUrl: p?.ssoUrl ?? '',
    certificates: (p?.certificates ?? []).join('\n\n'),
    emailAttribute: p?.emailAttribute ?? '',
    nameAttribute: p?.nameAttribute ?? '',
    groupsAttribute: p?.groupsAttribute ?? '',
    wantAssertionsSigned: p?.wantAssertionsSigned ?? true,
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
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
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
    const certificates = splitCertificates(form.certificates);
    if (certificates.length === 0) {
      setBusy(null);
      setErr('Paste at least one IdP signing certificate.');
      return;
    }
    const body = {
      enabled: form.enabled,
      idpEntityId: form.idpEntityId.trim(),
      ssoUrl: form.ssoUrl.trim(),
      certificates,
      emailAttribute: form.emailAttribute.trim() || null,
      nameAttribute: form.nameAttribute.trim() || null,
      groupsAttribute: form.groupsAttribute.trim() || null,
      wantAssertionsSigned: form.wantAssertionsSigned,
      roleMapping: { defaultRoles, groupClaim, emailDomainRoles, groupRoles },
      allowedEmailDomains: allowedDomains
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
    };
    const res = await clientFetch('/settings/saml', { method: 'PUT', body: JSON.stringify(body) });
    setBusy(null);
    if (res.ok) {
      router.refresh();
      setNote('Saved.');
    } else {
      setErr(res.error?.message ?? 'Could not save.');
    }
  }

  async function remove() {
    if (!confirm('Remove the SAML provider? Members will fall back to email sign-in.')) return;
    setBusy('delete');
    const res = await clientFetch('/settings/saml', { method: 'DELETE' });
    setBusy(null);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not remove.');
  }

  const codeBox = {
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
        <div className="label">Give these to your identity provider</div>
        <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              ACS URL (Assertion Consumer Service)
            </div>
            <code style={codeBox}>{config.acsUrl}</code>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              SP entity ID
            </div>
            <code style={codeBox}>{config.spEntityId}</code>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              SP metadata
            </div>
            <code style={codeBox}>{config.metadataUrl}</code>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Members start SAML at <span className="mono">{config.startUrl}</span> (or via the
          &quot;Continue with SSO&quot; box on the login page, protocol{' '}
          <span className="mono">SAML</span>, using{' '}
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
          <strong>Enable SAML sign-in for this workspace</strong>
        </label>

        <div className="field">
          <label className="label">IdP entity ID (assertion Issuer)</label>
          <input
            className="input mono"
            required
            value={form.idpEntityId}
            onChange={(e) => set('idpEntityId', e.target.value)}
            placeholder="https://idp.example.com/saml"
          />
        </div>
        <div className="field">
          <label className="label">IdP SSO URL (HTTP-Redirect)</label>
          <input
            className="input mono"
            required
            value={form.ssoUrl}
            onChange={(e) => set('ssoUrl', e.target.value)}
            placeholder="https://idp.example.com/sso/saml"
          />
        </div>
        <div className="field">
          <label className="label">
            IdP signing certificate(s) — PEM, paste one after another
          </label>
          <textarea
            className="input mono"
            required
            rows={6}
            value={form.certificates}
            onChange={(e) => set('certificates', e.target.value)}
            placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
          />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', margin: '4px 0 12px' }}>
          <input
            type="checkbox"
            checked={form.wantAssertionsSigned}
            onChange={(e) => set('wantAssertionsSigned', e.target.checked)}
          />
          Require the assertion itself to be signed (recommended)
        </label>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
        <div className="label">Attribute mapping</div>
        {(
          [
            ['emailAttribute', 'Email attribute (blank → well-known names, then NameID)'],
            ['nameAttribute', 'Display-name attribute'],
            ['groupsAttribute', 'Groups attribute'],
          ] as const
        ).map(([k, label]) => (
          <div className="field" key={k}>
            <label className="label">{label}</label>
            <input
              className="input mono"
              value={form[k]}
              onChange={(e) => set(k, e.target.value)}
            />
          </div>
        ))}

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
          <label className="label">Group attribute value (for the group → roles map)</label>
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
            {busy === 'save' ? 'Saving…' : p ? 'Save changes' : 'Configure SAML'}
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
