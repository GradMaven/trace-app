'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

interface ScanResult {
  datapointsScored: number;
  issuesOpened: number;
  issuesResolved: number;
  anomaliesFound: number;
}

/** Runs a trust + data-quality scan (requires `trust.run`). */
export function RunScanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch<ScanResult>('/data-quality/scan', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setBusy(false);
    if (res.ok && res.data) {
      setMsg(
        `Scored ${res.data.datapointsScored} · +${res.data.issuesOpened} issues · −${res.data.issuesResolved} · ${res.data.anomaliesFound} anomalies`,
      );
      router.refresh();
    } else {
      setMsg(res.error?.message ?? 'Scan failed.');
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      {msg && (
        <span className="muted" style={{ fontSize: 12 }}>
          {msg}
        </span>
      )}
      <button className="btn" onClick={() => void run()} disabled={busy}>
        {busy ? 'Scanning…' : 'Run scan'}
      </button>
    </span>
  );
}
