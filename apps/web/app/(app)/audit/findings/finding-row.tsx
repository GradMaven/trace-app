'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import { SeverityTag } from '@/components/audit-bits';

export interface Finding {
  id: string;
  source: string;
  severity: string;
  kind: string | null;
  status: string;
  subjectType: string;
  subjectId: string;
  title: string;
  detail: string;
  recommendation: string | null;
  dueOn: string | null;
  lastSeenAt: string;
  resolutionNote: string | null;
}

const OPEN = new Set(['open', 'acknowledged', 'remediating']);

export function FindingRow({ finding }: { finding: Finding }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(status: string) {
    setBusy(true);
    setErr(null);
    const res = await clientFetch(`/audit/findings/${finding.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Failed');
  }

  const open = OPEN.has(finding.status);

  return (
    <tr>
      <td>
        <SeverityTag severity={finding.severity} />
      </td>
      <td>
        <div>{finding.title}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {finding.detail}
        </div>
        {finding.resolutionNote && (
          <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>
            {finding.resolutionNote}
          </div>
        )}
      </td>
      <td className="mono muted" style={{ fontSize: 11 }}>
        {finding.subjectType === 'calculation' ? (
          <span>
            {finding.subjectType}:{finding.subjectId.slice(0, 8)}
          </span>
        ) : finding.subjectType === 'organization' || finding.subjectType === 'disclosure' ? (
          <span>
            {finding.subjectType}:{finding.subjectId}
          </span>
        ) : (
          <span>
            {finding.subjectType}:{finding.subjectId.slice(0, 8)}
          </span>
        )}
      </td>
      <td>
        <span className="tag">{finding.source}</span>
      </td>
      <td>
        <span className="tag">{finding.status.replace(/_/g, ' ')}</span>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {open ? (
            <>
              {finding.status !== 'acknowledged' && (
                <button className="btn" disabled={busy} onClick={() => void set('acknowledged')}>
                  Ack
                </button>
              )}
              {finding.status !== 'remediating' && (
                <button className="btn" disabled={busy} onClick={() => void set('remediating')}>
                  Remediating
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => void set('resolved')}>
                Resolve
              </button>
              <button className="btn" disabled={busy} onClick={() => void set('accepted_risk')}>
                Accept risk
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
