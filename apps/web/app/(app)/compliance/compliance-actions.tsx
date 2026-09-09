'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

const VERSION = 'esrs@2026.1';

export function ComplianceActions({ loaded }: { loaded: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'load' | 'evaluate'>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setBusy('load');
    setMsg(null);
    const res = await clientFetch<{ requiredDatapoints: number }>('/compliance/rule-stores/load', {
      method: 'POST',
      body: JSON.stringify({ version: VERSION }),
    });
    setBusy(null);
    if (res.ok && res.data) {
      setMsg(`Loaded ${VERSION} (${res.data.requiredDatapoints} required datapoints)`);
      router.refresh();
    } else setMsg(res.error?.message ?? 'Failed to load rule store.');
  }

  async function evaluate() {
    setBusy('evaluate');
    setMsg(null);
    const res = await clientFetch<{ readinessPct: number; mappingsWritten: number }>(
      '/compliance/evaluate',
      { method: 'POST', body: JSON.stringify({ version: VERSION, reportingPeriod: 'FY2025' }) },
    );
    setBusy(null);
    if (res.ok && res.data) {
      setMsg(`Evaluated — ${res.data.mappingsWritten} mappings, ${res.data.readinessPct}% ready`);
      router.refresh();
    } else setMsg(res.error?.message ?? 'Evaluation failed.');
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {msg && (
        <span className="muted" style={{ fontSize: 12 }}>
          {msg}
        </span>
      )}
      {!loaded && (
        <button className="btn" onClick={() => void load()} disabled={busy !== null}>
          {busy === 'load' ? 'Loading…' : 'Load ESRS rule store'}
        </button>
      )}
      {loaded && (
        <button className="btn" onClick={() => void evaluate()} disabled={busy !== null}>
          {busy === 'evaluate' ? 'Evaluating…' : 'Evaluate (FY2025)'}
        </button>
      )}
    </span>
  );
}
