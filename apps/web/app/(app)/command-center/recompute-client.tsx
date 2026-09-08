'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function RecomputeInventoryButton({ period }: { period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function recompute() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<{ groups: number; total: string }>('/emissions/recompute', {
      method: 'POST',
      body: JSON.stringify({ reportingPeriod: period }),
    });
    setBusy(false);
    if (res.ok && res.data) {
      setMsg(`${res.data.total} tCO2e across ${res.data.groups} groups`);
      router.refresh();
    } else setMsg(res.error?.message ?? 'Failed.');
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      <button className="btn" onClick={() => void recompute()} disabled={busy}>
        {busy ? 'Recomputing…' : `Recompute ${period} inventory`}
      </button>
    </div>
  );
}
