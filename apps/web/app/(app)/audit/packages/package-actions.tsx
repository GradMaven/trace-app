'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function GeneratePackage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<{
      status: string;
      contentDigest: string;
      manifest: { evidenceCount: number; calculationCount: number };
    }>('/audit/packages', { method: 'POST', body: JSON.stringify({}) });
    setBusy(false);
    if (res.ok && res.data) {
      setMsg(`${res.data.status} · ${res.data.contentDigest.slice(0, 12)}`);
      router.refresh();
    } else setMsg(res.error?.message ?? 'Failed.');
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {msg && (
        <span className="muted" style={{ fontSize: 12 }}>
          {msg}
        </span>
      )}
      <button className="btn" onClick={() => void generate()} disabled={busy}>
        {busy ? 'Generating…' : 'Generate audit package'}
      </button>
    </span>
  );
}

export function DownloadPackage({ packageId }: { packageId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setErr(null);
    const res = await clientFetch<{ url: string }>(`/audit/packages/${packageId}/download`);
    setBusy(false);
    if (res.ok && res.data) window.open(res.data.url, '_blank', 'noopener');
    else setErr(res.error?.message ?? 'Failed');
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button className="btn" disabled={busy} onClick={() => void download()}>
        {busy ? '…' : 'Download JSON'}
      </button>
      {err && <span style={{ color: 'var(--critical)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
