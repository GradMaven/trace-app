'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function ReadinessActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'sim' | 'pkg'>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function simulate() {
    setBusy('sim');
    setMsg(null);
    const res = await clientFetch<{
      readiness: { value: number };
      findingsOpened: number;
      findingsResolved: number;
    }>('/audit/simulate', { method: 'POST', body: JSON.stringify({}) });
    setBusy(null);
    if (res.ok && res.data) {
      setMsg(
        `Readiness ${res.data.readiness.value}/100 · +${res.data.findingsOpened} findings · −${res.data.findingsResolved}`,
      );
      router.refresh();
    } else setMsg(res.error?.message ?? 'Simulation failed.');
  }

  async function generate() {
    setBusy('pkg');
    setMsg(null);
    const res = await clientFetch<{ status: string; contentDigest: string }>('/audit/packages', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setBusy(null);
    if (res.ok && res.data) {
      setMsg(`Package ${res.data.status} · ${res.data.contentDigest.slice(0, 12)}`);
      router.refresh();
    } else setMsg(res.error?.message ?? 'Package generation failed.');
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {msg && (
        <span className="muted" style={{ fontSize: 12 }}>
          {msg}
        </span>
      )}
      <button className="btn" onClick={() => void simulate()} disabled={busy !== null}>
        {busy === 'sim' ? 'Simulating…' : 'Run simulation'}
      </button>
      <button className="btn" onClick={() => void generate()} disabled={busy !== null}>
        {busy === 'pkg' ? 'Generating…' : 'Generate audit package'}
      </button>
    </span>
  );
}
