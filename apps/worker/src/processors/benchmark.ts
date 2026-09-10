import { getPrisma, refreshBenchmarkBuckets, type BenchmarkRefreshResult } from '@trace/db';

/**
 * Rebuilds the cross-tenant benchmark buckets (Phase 14d). Iterates the opted-in
 * organizations, each through its own tenant context, and writes k-anonymised
 * sector aggregates. Runs daily; a bucket with fewer than the k-anonymity
 * threshold of contributors is stored `suppressed` with no numbers.
 */
export async function runBenchmarkRefresh(): Promise<BenchmarkRefreshResult> {
  return refreshBenchmarkBuckets(getPrisma());
}
