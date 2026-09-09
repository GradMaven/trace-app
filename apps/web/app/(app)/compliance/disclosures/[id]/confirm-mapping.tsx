'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function ConfirmMapping({
  mappingId,
  confirmed,
}: {
  mappingId: string;
  confirmed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    const res = await clientFetch(`/compliance/mappings/${mappingId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ confirm: !confirmed }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Failed');
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button className="btn" disabled={busy} onClick={() => void toggle()}>
        {busy ? '…' : confirmed ? 'Un-confirm' : 'Confirm mapping'}
      </button>
      {err && <span style={{ color: 'var(--critical)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
