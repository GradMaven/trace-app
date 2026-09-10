import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { BenchmarkPanel } from './benchmark-client';

export const dynamic = 'force-dynamic';

export interface BenchmarkSettings {
  sector: string | null;
  optIn: boolean;
  sectors: string[];
}
interface BucketStat {
  contributors: number;
  suppressed: boolean;
  p25: number | null;
  median: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}
export interface MetricComparison {
  metric: string;
  own: number | null;
  bucket: BucketStat | null;
  standing: 'ahead' | 'in_line' | 'behind' | 'unknown';
  positionPct: number | null;
}
export interface BenchmarkView {
  eligible: boolean;
  reason: string | null;
  sector: string | null;
  optIn: boolean;
  period: string | null;
  contributors: number | null;
  metrics: MetricComparison[];
}

export default async function BenchmarkPage() {
  const [settingsRes, viewRes] = await Promise.all([
    serverFetch<BenchmarkSettings>('/network/benchmark/settings'),
    serverFetch<BenchmarkView>('/network/benchmark'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 820 }}>
      <div>
        <Link href="/supply-chain/carbon-twin" className="muted" style={{ fontSize: 13 }}>
          ← Carbon Twin
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0 0' }}>Carbon Twin — sector benchmark</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Compare your data-quality ratios against an <strong>anonymised</strong> aggregate of your
          sector. Only organisations that opt in contribute, and a sector bucket is hidden until at
          least five have — the platform only ever stores medians and quartiles, never a
          per-organisation value.
        </p>
      </div>
      {settingsRes.error && <p style={{ color: 'var(--critical)' }}>{settingsRes.error.message}</p>}
      {settingsRes.data && (
        <BenchmarkPanel settings={settingsRes.data} view={viewRes.data ?? null} />
      )}
    </div>
  );
}
