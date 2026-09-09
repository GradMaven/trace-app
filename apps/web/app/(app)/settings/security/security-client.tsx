'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { MfaStatus, OrgSecurity } from './page';

export function SecurityClient({
  mfa,
  mfaError,
  org,
}: {
  mfa: MfaStatus | null;
  mfaError: string | null;
  org: OrgSecurity | null;
}) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <MfaCard mfa={mfa} error={mfaError} />
      {org && <OrgSecurityCard org={org} />}
    </div>
  );
}

function MfaCard({ mfa, error }: { mfa: MfaStatus | null; error: string | null }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function beginSetup() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<{ secret: string; otpauthUrl: string }>('/me/mfa/setup', {
      method: 'POST',
    });
    setBusy(false);
    if (res.ok && res.data) setSetup(res.data);
    else setMsg(res.error?.message ?? 'Could not start enrolment.');
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<{ recoveryCodes: string[] }>('/me/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
    setBusy(false);
    if (res.ok && res.data) {
      setRecovery(res.data.recoveryCodes);
      setSetup(null);
      setCode('');
      router.refresh();
    } else {
      setMsg(res.error?.message ?? 'That code was not accepted.');
    }
  }

  async function disable() {
    const c = prompt('Enter a current authenticator code (or a recovery code) to turn off 2FA:');
    if (!c) return;
    const res = await clientFetch('/me/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ code: c.trim() }),
    });
    if (res.ok) {
      setRecovery(null);
      router.refresh();
    } else {
      setMsg(res.error?.message ?? 'Could not disable 2FA.');
    }
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Two-factor authentication</h2>
      {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}

      {mfa?.enrolled ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            <span className="tag" style={{ color: 'var(--positive)' }}>
              enabled
            </span>{' '}
            since {mfa.confirmedAt ? new Date(mfa.confirmedAt).toLocaleDateString() : '—'} ·{' '}
            {mfa.recoveryCodesRemaining} recovery codes left
            {mfa.lastUsedAt && ` · last used ${new Date(mfa.lastUsedAt).toLocaleString()}`}
          </p>
          {mfa.orgMandates ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Your organization requires 2FA, so it cannot be turned off here.
            </p>
          ) : (
            <button className="btn" onClick={() => void disable()}>
              Turn off 2FA
            </button>
          )}
        </>
      ) : setup ? (
        <form onSubmit={confirm}>
          <p className="muted" style={{ marginTop: 0 }}>
            Add this account to your authenticator app, then enter the current code to finish.
          </p>
          <div className="field">
            <label className="label">Setup key</label>
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
              {setup.secret}
            </code>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              or paste this URI:{' '}
              <span className="mono" style={{ wordBreak: 'break-all' }}>
                {setup.otpauthUrl}
              </span>
            </p>
          </div>
          <div className="field">
            <label className="label">Code from your app</label>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
          </div>
          {msg && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{msg}</p>}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || code.trim().length < 6}
          >
            {busy ? 'Confirming…' : 'Confirm & enable'}
          </button>{' '}
          <button className="btn" type="button" onClick={() => setSetup(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Not enabled.{' '}
            {mfa?.orgMandates && (
              <strong style={{ color: 'var(--critical)' }}>Your organization requires it.</strong>
            )}
          </p>
          {msg && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{msg}</p>}
          <button className="btn btn-primary" onClick={() => void beginSetup()} disabled={busy}>
            {busy ? 'Starting…' : 'Set up 2FA'}
          </button>
        </>
      )}

      {recovery && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <strong>Recovery codes</strong>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
            Store these somewhere safe. Each works once if you lose your authenticator.
          </p>
          <pre
            className="mono"
            style={{
              background: 'var(--bg-subtle)',
              padding: 12,
              borderRadius: 6,
              userSelect: 'all',
            }}
          >
            {recovery.join('\n')}
          </pre>
        </div>
      )}
    </section>
  );
}

function OrgSecurityCard({ org }: { org: OrgSecurity }) {
  const router = useRouter();
  const [requireMfa, setRequireMfa] = useState(org.requireMfa);
  const [legalHold, setLegalHold] = useState(org.legalHold);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = requireMfa !== org.requireMfa || legalHold !== org.legalHold;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch('/settings/security', {
      method: 'PUT',
      body: JSON.stringify({ requireMfa, legalHold }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setMsg(res.error?.message ?? 'Could not save.');
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Organization security</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {org.membersWithMfa}/{org.members} members have 2FA enabled.
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 8 }}>
        <input
          type="checkbox"
          checked={requireMfa}
          onChange={(e) => setRequireMfa(e.target.checked)}
        />
        <span>
          <strong>Require two-factor authentication</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            Every member must enrol before they can use the workspace.
          </div>
        </span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 10 }}>
        <input
          type="checkbox"
          checked={legalHold}
          onChange={(e) => setLegalHold(e.target.checked)}
        />
        <span>
          <strong>Legal hold</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            Suspends retention deletion — nothing is purged while this is on.
          </div>
        </span>
      </label>
      {msg && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{msg}</p>}
      <button
        className="btn btn-primary"
        style={{ marginTop: 12 }}
        disabled={!dirty || busy}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </section>
  );
}
