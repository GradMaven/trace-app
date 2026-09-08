'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export default function OnboardingPage() {
  const router = useRouter();
  const [legalName, setLegalName] = useState('');
  const [country, setCountry] = useState('DE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await clientFetch<{ id: string }>('/organizations', {
      method: 'POST',
      body: JSON.stringify({ legalName, country }),
    });
    setBusy(false);
    if (res.ok) router.replace('/command-center');
    else setError(res.error?.message ?? 'Could not create the organization.');
  }

  return (
    <main style={{ maxWidth: 460, margin: '12vh auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Create your organization</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        You will become its Organization Admin. You can invite colleagues next.
      </p>
      <form onSubmit={submit} className="card">
        <div className="field">
          <label className="label" htmlFor="legalName">
            Legal entity name
          </label>
          <input
            id="legalName"
            required
            minLength={2}
            className="input"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="NordWerk Manufacturing AG"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="country">
            Country (ISO 3166-1 alpha-2)
          </label>
          <input
            id="country"
            required
            pattern="[A-Za-z]{2}"
            maxLength={2}
            className="input"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </div>
        {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create organization'}
        </button>
      </form>
    </main>
  );
}
