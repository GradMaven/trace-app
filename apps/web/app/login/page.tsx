'use client';

import { useState } from 'react';
import { clientFetch } from '@/lib/client-api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main style={{ maxWidth: 400, margin: '12vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>TRACE</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
        Sign in to your sustainability evidence workspace.
      </p>

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
          {error && (
            <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>
          )}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
      )}
    </main>
  );
}
