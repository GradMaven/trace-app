'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import { API_BASE } from '@/lib/api';

function LoginInner() {
  const params = useSearchParams();
  const ssoError = params.get('sso_error');

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [protocol, setProtocol] = useState<'oidc' | 'saml'>('oidc');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await clientFetch('/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (res.ok) setSent(true);
    else setError(res.error?.message ?? 'Something went wrong.');
  }

  function startSso(e: React.FormEvent) {
    e.preventDefault();
    const s = slug.trim().toLowerCase();
    if (!s) return;
    const path = protocol === 'saml' ? 'auth/saml' : 'auth/sso';
    window.location.href = `${API_BASE}/${path}/${encodeURIComponent(s)}/start`;
  }

  return (
    <main style={{ maxWidth: 400, margin: '12vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>TRACE</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
        Sign in to your sustainability evidence workspace.
      </p>

      {ssoError && (
        <p style={{ color: 'var(--critical)', fontSize: 13 }}>
          Single sign-on failed ({ssoError}). Try the email link, or contact your admin.
        </p>
      )}

      {sent ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            If <strong>{email}</strong> has an account or a pending invitation, a sign-in link is on
            its way.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            In development the link is printed in the API server log.
          </p>
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="card">
            <div className="field">
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>

          <form onSubmit={startSso} className="card" style={{ marginTop: 14 }}>
            <div className="field">
              <label className="label" htmlFor="slug">
                Single sign-on
              </label>
              <input
                id="slug"
                className="input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="workspace identifier"
              />
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Your organization&apos;s short name, e.g. <span className="mono">nordwerk</span>.
              </p>
            </div>
            <div className="field">
              <label className="label" htmlFor="sso-protocol">
                Protocol
              </label>
              <select
                id="sso-protocol"
                className="input"
                value={protocol}
                onChange={(e) => setProtocol(e.target.value === 'saml' ? 'saml' : 'oidc')}
              >
                <option value="oidc">OpenID Connect</option>
                <option value="saml">SAML 2.0</option>
              </select>
            </div>
            <button className="btn" type="submit" disabled={!slug.trim()}>
              Continue with SSO →
            </button>
          </form>
        </>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main style={{ padding: 24 }} className="muted">
          Loading…
        </main>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
