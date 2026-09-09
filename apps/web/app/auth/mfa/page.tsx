'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export default function MfaChallengePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await clientFetch('/auth/mfa', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace('/');
    } else {
      setErr(res.error?.message ?? 'That code was not accepted.');
    }
  }

  async function logout() {
    await clientFetch('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <main style={{ maxWidth: 400, margin: '16vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>Two-factor authentication</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Enter the 6-digit code from your authenticator app, or a recovery code.
      </p>
      <form onSubmit={submit}>
        <input
          className="input"
          autoFocus
          inputMode="text"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ letterSpacing: 2 }}
        />
        {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || code.trim().length < 4}
          style={{ marginTop: 10 }}
        >
          {busy ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      <button className="btn" onClick={() => void logout()} style={{ marginTop: 16 }}>
        Sign out
      </button>
    </main>
  );
}
