'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function CreateSupplier() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('DE');
  const [industryNace, setIndustry] = useState('');
  const [category, setCategory] = useState('');
  const [spend, setSpend] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { name, country };
    if (industryNace) body.industryNace = industryNace;
    if (category || spend) {
      body.relationship = {
        ...(category ? { category } : {}),
        ...(spend ? { annualSpend: Number(spend) } : {}),
      };
    }
    const res = await clientFetch<{ id: string }>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok && res.data) router.push(`/supply-chain/suppliers/${res.data.id}`);
    else setError(res.error?.message ?? 'Could not create the supplier.');
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Add supplier
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
        zIndex: 50,
      }}
      onClick={() => setOpen(false)}
    >
      <form
        className="card"
        style={{ width: 460, maxWidth: '90vw' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Add supplier</h2>
        <div className="field">
          <label className="label">Name</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Country</label>
            <input
              className="input"
              required
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label className="label">Industry (NACE, optional)</label>
            <input className="input" value={industryNace} onChange={(e) => setIndustry(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 2 }}>
            <label className="label">Category (optional)</label>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Annual spend € (optional)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={spend}
              onChange={(e) => setSpend(e.target.value)}
            />
          </div>
        </div>
        {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
