'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function NewProductForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [functionalUnit, setFunctionalUnit] = useState('1 unit');
  const [referenceUnit, setReferenceUnit] = useState('unit');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await clientFetch<{ id: string }>('/products', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        sku: sku.trim() || null,
        functionalUnit: functionalUnit.trim(),
        referenceUnit: referenceUnit.trim(),
      }),
    });
    setBusy(false);
    if (res.ok && res.data) router.push(`/carbon/products/${res.data.id}`);
    else setErr(res.error?.message ?? 'Could not create the product.');
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        New product
      </button>
    );
  }

  return (
    <form className="card" onSubmit={submit} style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
      <div className="field">
        <label className="label">Name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label">SKU (optional)</label>
        <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Functional unit</label>
          <input
            className="input"
            required
            value={functionalUnit}
            onChange={(e) => setFunctionalUnit(e.target.value)}
            placeholder="1 t rolled steel"
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label className="label">Reference unit</label>
          <input
            className="input"
            required
            value={referenceUnit}
            onChange={(e) => setReferenceUnit(e.target.value)}
            placeholder="t"
          />
        </div>
      </div>
      {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
