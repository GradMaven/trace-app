'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function ActivityActions({
  activityId,
  linkableEvidence,
}: {
  activityId: string;
  linkableEvidence: Array<{ id: string; title: string; type: string }>;
  canCalculate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [evidenceId, setEvidenceId] = useState('');

  async function runCalc() {
    setBusy('calc');
    setMsg(null);
    const res = await clientFetch<{ resultValueTco2e: string; calculationId: string }>(
      '/calculations/run',
      { method: 'POST', body: JSON.stringify({ activityId }) },
    );
    setBusy(null);
    if (res.ok && res.data) {
      router.push(`/carbon/calculations/${res.data.calculationId}/lineage`);
    } else setMsg({ kind: 'err', text: res.error?.message ?? 'Calculation failed.' });
  }

  async function link() {
    if (!evidenceId) return;
    setBusy('link');
    setMsg(null);
    const res = await clientFetch(`/activity-data/${activityId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ evidenceId }),
    });
    setBusy(null);
    if (res.ok) {
      setEvidenceId('');
      router.refresh();
    } else setMsg({ kind: 'err', text: res.error?.message ?? 'Could not link evidence.' });
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => void runCalc()}>
          {busy === 'calc' ? 'Calculating…' : 'Run calculation'}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          Picks the best-matching current emission factor and computes deterministically.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="input"
          value={evidenceId}
          onChange={(e) => setEvidenceId(e.target.value)}
          style={{ maxWidth: 360 }}
        >
          <option value="">Link evidence…</option>
          {linkableEvidence.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} ({e.type.replace(/_/g, ' ')})
            </option>
          ))}
        </select>
        <button className="btn" disabled={busy !== null || !evidenceId} onClick={() => void link()}>
          {busy === 'link' ? 'Linking…' : 'Link'}
        </button>
      </div>
      {msg && (
        <p style={{ margin: 0, fontSize: 13, color: msg.kind === 'ok' ? 'var(--positive)' : 'var(--critical)' }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
