'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export interface Issue {
  id: string;
  kind: string;
  severity: string;
  status: string;
  subjectType: string;
  subjectId: string;
  datapointId: string | null;
  metricKey: string | null;
  reportingPeriod: string | null;
  title: string;
  detail: string;
  rulesVersion: string;
  firstDetectedAt: string;
  lastSeenAt: string;
  resolutionNote: string | null;
}

const SEV_COLOR: Record<string, string | undefined> = {
  critical: 'var(--critical)',
  warning: 'var(--attention)',
  info: undefined,
};

export function IssueRow({ issue }: { issue: Issue }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function set(status: string) {
    setBusy(true);
    setErr(null);
    const res = await clientFetch(`/data-quality/issues/${issue.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Failed');
  }

  const open = issue.status === 'open' || issue.status === 'acknowledged';

  return (
    <tr>
      <td>
        <span className="tag" style={{ color: SEV_COLOR[issue.severity] }}>
          {issue.severity}
        </span>
      </td>
      <td>
        <div>{issue.title}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {issue.detail}
        </div>
        {issue.resolutionNote && (
          <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>
            {issue.resolutionNote}
          </div>
        )}
      </td>
      <td className="mono muted" style={{ fontSize: 12 }}>
        {issue.datapointId ? (
          <Link href={`/data/datapoints/${issue.datapointId}`} style={{ color: 'var(--accent)' }}>
            {issue.metricKey ?? issue.kind}
          </Link>
        ) : (
          (issue.metricKey ?? issue.kind)
        )}
        <br />
        {issue.subjectType}:{issue.subjectId.slice(0, 8)}
        {issue.reportingPeriod ? ` · ${issue.reportingPeriod}` : ''}
      </td>
      <td>
        <span className="tag">{issue.status}</span>
      </td>
      <td className="muted" style={{ fontSize: 12 }}>
        {new Date(issue.lastSeenAt).toLocaleDateString()}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {open && (
            <>
              {issue.status !== 'acknowledged' && (
                <button className="btn" disabled={busy} onClick={() => void set('acknowledged')}>
                  Ack
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => void set('resolved')}>
                Resolve
              </button>
              <button className="btn" disabled={busy} onClick={() => void set('dismissed')}>
                Dismiss
              </button>
            </>
          )}
          {!open && (
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
