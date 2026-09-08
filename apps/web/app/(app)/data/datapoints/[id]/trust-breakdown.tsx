'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

/** Recompute this datapoint's Trust Score (requires `trust.run`). */
export function TrustBreakdown({ datapointId }: { datapointId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function recompute() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<{ value: number; unchanged: boolean }>(
      `/trust/scores/${datapointId}/recompute`,
      { method: 'POST' },
    );
    setBusy(false);
    if (res.ok && res.data) {
      setMsg(res.data.unchanged ? 'No change' : `Updated to ${res.data.value}`);
      router.refresh();
    } else {
      setMsg(res.error?.message ?? 'Failed');
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {msg && (
        <span className="muted" style={{ fontSize: 12 }}>
          {msg}
        </span>
      )}
      <button className="btn" onClick={() => void recompute()} disabled={busy}>
        {busy ? 'Recomputing…' : 'Recompute'}
      </button>
    </span>
  );
}
