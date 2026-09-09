import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { DownloadPackage, GeneratePackage } from './package-actions';

export const dynamic = 'force-dynamic';

interface Manifest {
  sections?: string[];
  evidenceCount?: number;
  calculationCount?: number;
  reproducedCalculations?: number;
  datapointCount?: number;
  complianceMappingCount?: number;
  openFindingCount?: number;
  auditChainIntact?: boolean;
  readinessValue?: number | null;
}

interface Pkg {
  id: string;
  status: string;
  reportingPeriod: string | null;
  ruleStoreVersion: string | null;
  format: string;
  sizeBytes: number | null;
  contentDigest: string;
  readinessValue: number | null;
  manifest: Manifest;
  generatedAt: string | null;
  createdAt: string;
  error: string | null;
}

export default async function PackagesPage() {
  const res = await serverFetch<Pkg[]>('/audit/packages?limit=25');
  const rows = res.data ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Audit — Package</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            A content-addressed JSON bundle of the organization&apos;s own records and their lineage
            — evidence, calculations, reproducibility, datapoints, compliance mappings, open
            findings and the audit-log chain verification. It supports professional judgement; it is
            not an assurance opinion.
          </p>
          <Link href="/audit/readiness" style={{ color: 'var(--accent)', fontSize: 13 }}>
            ← Readiness
          </Link>
        </div>
        <GeneratePackage />
      </div>

      {res.error && <p style={{ color: 'var(--critical)' }}>{res.error.message}</p>}

      {rows.length === 0 ? (
        <p className="notice">No audit packages yet.</p>
      ) : (
        rows.map((p) => (
          <section key={p.id} className="card">
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span
                className="tag"
                style={{
                  color:
                    p.status === 'ready'
                      ? 'var(--positive)'
                      : p.status === 'failed'
                        ? 'var(--critical)'
                        : undefined,
                }}
              >
                {p.status}
              </span>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {p.contentDigest.slice(0, 16)}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {p.reportingPeriod ?? 'all'} · {p.ruleStoreVersion ?? '—'} ·{' '}
                {p.sizeBytes != null ? `${(p.sizeBytes / 1024).toFixed(1)} kB` : '—'} ·{' '}
                {p.generatedAt
                  ? new Date(p.generatedAt).toLocaleString()
                  : new Date(p.createdAt).toLocaleString()}
              </span>
              <span style={{ marginLeft: 'auto' }}>
                {p.status === 'ready' && <DownloadPackage packageId={p.id} />}
              </span>
            </div>
            {p.error && <p style={{ color: 'var(--critical)', fontSize: 12 }}>{p.error}</p>}
            {p.status === 'ready' && (
              <div
                style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}
                className="muted"
              >
                <span>readiness {p.manifest.readinessValue ?? p.readinessValue ?? '—'}/100</span>
                <span>{p.manifest.evidenceCount ?? 0} evidence</span>
                <span>
                  {p.manifest.reproducedCalculations ?? 0}/{p.manifest.calculationCount ?? 0}{' '}
                  calculations reproduce
                </span>
                <span>{p.manifest.datapointCount ?? 0} datapoints</span>
                <span>{p.manifest.complianceMappingCount ?? 0} mappings</span>
                <span>{p.manifest.openFindingCount ?? 0} open findings</span>
                <span
                  style={{
                    color: p.manifest.auditChainIntact ? 'var(--positive)' : 'var(--critical)',
                  }}
                >
                  audit chain {p.manifest.auditChainIntact ? 'intact' : 'BROKEN'}
                </span>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
