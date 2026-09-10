import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_K_ANON,
  compareToBenchmark,
  computeBenchmarkBuckets,
  isBenchmarkMetric,
  isBenchmarkSector,
  type BenchmarkContribution,
} from './benchmark';

function contrib(sector: string, primary: number, evidence?: number): BenchmarkContribution {
  return {
    sector,
    values: {
      primary_data_share_pct: primary,
      ...(evidence != null ? { evidence_backed_pct: evidence } : {}),
    },
  };
}

describe('computeBenchmarkBuckets', () => {
  it('suppresses a bucket below the k-anonymity threshold', () => {
    const buckets = computeBenchmarkBuckets(
      Array.from({ length: BENCHMARK_K_ANON - 1 }, (_, i) => contrib('manufacturing', 50 + i)),
      { period: '2026-W37' },
    );
    const b = buckets.find((x) => x.metric === 'primary_data_share_pct')!;
    expect(b.suppressed).toBe(true);
    expect(b.contributors).toBe(BENCHMARK_K_ANON - 1);
    expect(b.median).toBeNull();
  });

  it('publishes quartiles at or above the threshold (nearest-rank)', () => {
    const values = [10, 20, 30, 40, 50, 60, 70];
    const buckets = computeBenchmarkBuckets(
      values.map((v) => contrib('logistics', v)),
      { period: 'p1' },
    );
    const b = buckets.find((x) => x.metric === 'primary_data_share_pct')!;
    expect(b.suppressed).toBe(false);
    expect(b.contributors).toBe(7);
    expect(b.min).toBe(10);
    expect(b.max).toBe(70);
    expect(b.median).toBe(40);
    expect(b.p25).toBe(20);
    expect(b.p75).toBe(60);
  });

  it('separates sectors and metrics', () => {
    const buckets = computeBenchmarkBuckets(
      [
        ...Array.from({ length: 5 }, () => contrib('manufacturing', 60, 70)),
        ...Array.from({ length: 5 }, () => contrib('retail', 30)),
      ],
      { period: 'p1' },
    );
    expect(buckets.filter((b) => b.sector === 'manufacturing')).toHaveLength(2);
    expect(buckets.filter((b) => b.sector === 'retail')).toHaveLength(1);
  });

  it('returns nothing for no contributions', () => {
    expect(computeBenchmarkBuckets([], { period: 'p1' })).toEqual([]);
  });
});

describe('compareToBenchmark', () => {
  const bucket = {
    sector: 'manufacturing',
    metric: 'primary_data_share_pct' as const,
    period: 'p1',
    contributors: 8,
    suppressed: false,
    p25: 40,
    median: 55,
    p75: 70,
    min: 20,
    max: 90,
  };

  it('grades ahead / in line / behind vs the median', () => {
    expect(compareToBenchmark(75, bucket, 'primary_data_share_pct').standing).toBe('ahead');
    expect(compareToBenchmark(56, bucket, 'primary_data_share_pct').standing).toBe('in_line');
    expect(compareToBenchmark(30, bucket, 'primary_data_share_pct').standing).toBe('behind');
  });

  it('is unknown when own or bucket is missing / suppressed', () => {
    expect(compareToBenchmark(null, bucket, 'primary_data_share_pct').standing).toBe('unknown');
    expect(compareToBenchmark(50, null, 'primary_data_share_pct').standing).toBe('unknown');
    expect(
      compareToBenchmark(50, { ...bucket, suppressed: true, median: null }, 'primary_data_share_pct')
        .standing,
    ).toBe('unknown');
  });

  it('reports a position within [min, max]', () => {
    const c = compareToBenchmark(55, bucket, 'primary_data_share_pct');
    expect(c.positionPct).toBe(50); // (55-20)/(90-20)*100
  });
});

describe('guards', () => {
  it('validates metric + sector names', () => {
    expect(isBenchmarkMetric('primary_data_share_pct')).toBe(true);
    expect(isBenchmarkMetric('nope')).toBe(false);
    expect(isBenchmarkSector('manufacturing')).toBe(true);
    expect(isBenchmarkSector('space_mining')).toBe(false);
  });
});
