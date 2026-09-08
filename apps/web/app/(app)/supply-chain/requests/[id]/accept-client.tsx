'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function AcceptRequestButton({
  requestId,
  supplierId,
}: {
  requestId: string;
  supplierId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setErr(null);
    const res = await clientFetch(`/supplier-requests/${requestId}/accept`, { method: 'POST' });
    setBusy(false);
    if (res.ok) router.push(`/supply-chain/suppliers/${supplierId}`);
    else setErr(res.error?.message ?? 'Failed to accept.');
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={() => void accept()} disabled={busy}>
        {busy ? 'Accepting…' : 'Accept & update passport'}
      </button>
      {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
    </div>
  );
}
