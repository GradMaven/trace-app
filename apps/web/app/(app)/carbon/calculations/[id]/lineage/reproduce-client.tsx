'use client';

import { useState } from 'react';
import { clientFetch } from '@/lib/client-api';

export function ReproduceButton({ calculationId }: { calculationId: string }) {
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reproduce() {
    setBusy(true);
    setState(null);
    const res = await clientFetch<{
      reproduced: boolean;
      storedResult: string;
      recomputedResult: string;
    }>(`/calculations/${calculationId}/reproduce`, { method: 'POST' });
    setBusy(false);
    if (res.ok && res.data) {
      setState(
        res.data.reproduced
          ? `Reproduced exactly: ${res.data.recomputedResult} tCO2e`
          : `MISMATCH — stored ${res.data.storedResult}, recomputed ${res.data.recomputedResult}`,
      );
    } else setState(res.error?.message ?? 'Failed.');
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button className="btn" onClick={() => void reproduce()} disabled={busy}>
        {busy ? 'Recomputing…' : 'Reproduce from stored inputs'}
      </button>
      {state && (
        <span
          style={{
            fontSize: 13,
            color: state.startsWith('Reproduced') ? 'var(--positive)' : 'var(--critical)',
          }}
        >
          {state}
        </span>
      )}
    </div>
  );
}
