'use client';

import { useState } from 'react';
import { clientFetch } from '@/lib/client-api';

export function VerifyChainButton() {
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setState(null);
    const res = await clientFetch<{ intact: boolean; brokenAt: number; count: number }>(
      '/audit-log/verify',
      { method: 'POST' },
    );
    setBusy(false);
    if (res.ok && res.data) {
      setState(
        res.data.intact
          ? `Chain intact — ${res.data.count} entries verified.`
          : `Chain BROKEN at entry #${res.data.brokenAt}.`,
      );
    } else {
      setState(res.error?.message ?? 'Verification failed.');
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {state && (
        <span
          style={{
            fontSize: 13,
            color: state.includes('intact') ? 'var(--positive)' : 'var(--critical)',
          }}
        >
          {state}
        </span>
      )}
      <button className="btn" onClick={() => void verify()} disabled={busy}>
        {busy ? 'Verifying…' : 'Verify chain'}
      </button>
    </div>
  );
}
