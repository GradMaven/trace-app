import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { ImportWizard } from './import-wizard';

export const dynamic = 'force-dynamic';

interface Adapter {
  kind: string;
  label: string;
  targetFields: Array<{
    key: string;
    label: string;
    required: boolean;
    kind: string;
    enum?: string[];
    hint?: string;
  }>;
  sampleHeaders: string[];
}

export default async function ImportPage() {
  const res = await serverFetch<Adapter[]>('/integrations/adapters');
  const csv = res.data?.find((a) => a.kind === 'csv_activity');

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 920 }}>
      <div>
        <Link href="/settings/integrations" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Integrations
        </Link>
        <h1 style={{ fontSize: 20, margin: '6px 0 0' }}>Import activity data</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Upload a CSV or TSV, map its columns to the TRACE activity-data fields, review the per-row
          validation, then import the valid rows. Imported rows are stamped{' '}
          <span className="mono">source_ref = import:&lt;run&gt;:&lt;line&gt;</span> and default to{' '}
          <span className="mono">estimated</span> provenance unless you map one. Nothing is written
          until you click import.
        </p>
        {csv && (
          <p className="muted" style={{ fontSize: 12 }}>
            Example header row: <span className="mono">{csv.sampleHeaders.join(',')}</span>
          </p>
        )}
      </div>

      {!csv ? (
        <p style={{ color: 'var(--critical)' }}>
          {res.error?.message ?? 'No import adapter available.'}
        </p>
      ) : (
        <ImportWizard targetFields={csv.targetFields} />
      )}
    </div>
  );
}
