'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export interface Anomaly {
  id: string;
  method: string;
  status: string;
  subjectType: string;
  subjectId: string;
  datapointId: string | null;
  metricKey: string;
  pointKey: string;
  reportingPeriod: string | null;
  observedValue: string;
  expectedValue: string;
  score: string;
  direction: string;
  explanations: string[];
  detectorVersion: string;
  detectedAt: string;
}

export function AnomalyRow({ anomaly }: { anomaly: Anomaly }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(status: string) {
    setBusy(true);
    setErr(null);
    const res = await clientFetch(`/data-quality/anomalies/${anomaly.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Failed');
  }

  return (
    <tr>
      <td>
        <span className="tag">{anomaly.method.replace(/_/g, ' ')}</span>{' '}
        <span className="muted" style={{ fontSize: 12 }}>
          {anomaly.direction}
        </span>
      </td>
      <td className="mono muted" style={{ fontSize: 12 }}>
        {anomaly.datapointId ? (
          <Link href={`/data/datapoints/${anomaly.datapointId}`} style={{ color: 'var(--accent)' }}>
            {anomaly.metricKey}
          </Link>
        ) : (
          anomaly.metricKey
        )}
        <br />
        {anomaly.subjectType}:{anomaly.subjectId.slice(0, 8)} · {anomaly.pointKey}
      </td>
      <td className="mono">
        {anomaly.observedValue} → {anomaly.expectedValue}
      </td>
      <td className="mono">{anomaly.score}</td>
      <td className="muted" style={{ fontSize: 12, maxWidth: 320 }}>
        {anomaly.explanations.map((e, idx) => (
          <div key={idx}>{e}</div>
        ))}
      </td>
      <td>
        <span className="tag">{anomaly.status}</span>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {anomaly.status === 'open' ? (
            <>
              <button className="btn" disabled={busy} onClick={() => void set('explained')}>
                Explained
              </button>
              <button className="btn" disabled={busy} onClick={() => void set('dismissed')}>
                Dismiss
              </button>
            </>
          ) : (
            <button className="btn" disabled={busy} onClick={() => void set('open')}>
              Reopen
            </button>
          )}
        </div>
        {err && <div style={{ color: 'var(--critical)', fontSize: 12 }}>{err}</div>}
      </td>
    </tr>
  );
}
