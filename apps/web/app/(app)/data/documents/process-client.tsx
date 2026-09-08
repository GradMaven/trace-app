'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function ProcessButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function process() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<{ status: string; candidateCount: number; error?: string }>(
      `/documents/${documentId}/process`,
      { method: 'POST' },
    );
    setBusy(false);
    if (res.ok && res.data) {
      if (res.data.status === 'failed') {
        setMsg(res.data.error ?? 'Extraction failed.');
      } else {
        router.push('/data/candidates');
      }
    } else setMsg(res.error?.message ?? 'Failed.');
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {msg && <span style={{ fontSize: 12, color: 'var(--critical)' }}>{msg}</span>}
      <button className="btn" onClick={() => void process()} disabled={busy}>
        {busy ? 'Extracting…' : 'Extract data'}
      </button>
    </span>
  );
}
