import { serverFetch } from '@/lib/server-api';
import { DataGovernanceClient } from './data-client';

export const dynamic = 'force-dynamic';

export interface ExportJobView {
  id: string;
  status: string;
  reportingPeriod: string | null;
  totalRecords: number;
  sizeBytes: number | null;
  sha256: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  error: string | null;
}

export interface RetentionTarget {
  key: string;
  label: string;
  dateField: string;
  min: number;
  description: string;
}
export interface RetentionPolicy {
  id: string;
  target: string;
  label: string;
  ageDays: number;
  enabled: boolean;
  minAgeDays: number;
  lastRunAt: string | null;
}
export interface RetentionRun {
  id: string;
  target: string;
  label: string;
  mode: string;
  ageDays: number;
  matched: number;
  deleted: number;
  startedAt: string;
}

export default async function DataGovernancePage() {
  const [exportsRes, targetsRes, retentionRes] = await Promise.all([
    serverFetch<ExportJobView[]>('/exports'),
    serverFetch<RetentionTarget[]>('/settings/retention/targets'),
    serverFetch<{ policies: RetentionPolicy[]; runs: RetentionRun[] }>('/settings/retention'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 940 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Data &amp; Retention</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Export a full copy of this organization&apos;s records, and set how long operational data
          is kept. Evidence, calculations, datapoints and the audit log are never subject to
          retention — TRACE keeps the spine.
        </p>
      </div>
      <DataGovernanceClient
        exports={exportsRes.data ?? []}
        exportsError={exportsRes.error?.message ?? null}
        targets={targetsRes.data ?? []}
        policies={retentionRes.data?.policies ?? []}
        runs={retentionRes.data?.runs ?? []}
        retentionError={retentionRes.error?.message ?? null}
      />
    </div>
  );
}
