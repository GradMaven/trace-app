'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function GenerateFiling() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [period, setPeriod] = useState('');

  async function generate() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<{ readiness: string; version: number; sha256: string }>(
      '/filings/generate',
      {
        method: 'POST',
        body: JSON.stringify(period.trim() ? { reportingPeriod: period.trim() } : {}),
      },
    );
    setBusy(false);
    if (res.ok && res.data) {
      setMsg(`v${res.data.version} · ${res.data.readiness} · ${res.data.sha256.slice(0, 12)}`);
      router.refresh();
    } else setMsg(res.error?.message ?? 'Failed.');
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {msg && (
        <span className="muted" style={{ fontSize: 12 }}>
          {msg}
        </span>
      )}
      <input
        className="input"
        placeholder="reporting period (e.g. FY2025)"
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
        style={{ width: 190 }}
      />
      <button className="btn btn-primary" onClick={() => void generate()} disabled={busy}>
        {busy ? 'Assembling…' : 'Generate filing'}
      </button>
    </span>
  );
}

export function DownloadFiling({ filingId }: { filingId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function download(format: 'json' | 'html') {
    setBusy(format);
    setErr(null);
    const res = await clientFetch<{ url: string }>(
      `/filings/${filingId}/download?format=${format}`,
    );
    setBusy(null);
    if (res.ok && res.data) window.open(res.data.url, '_blank', 'noopener');
    else setErr(res.error?.message ?? 'Failed');
  }

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button className="btn" disabled={busy !== null} onClick={() => void download('json')}>
        {busy === 'json' ? '…' : 'Download JSON'}
      </button>
      <button className="btn" disabled={busy !== null} onClick={() => void download('html')}>
        {busy === 'html' ? '…' : 'Download HTML'}
      </button>
      {err && <span style={{ color: 'var(--critical)', fontSize: 12 }}>{err}</span>}
    </span>
  );
}
