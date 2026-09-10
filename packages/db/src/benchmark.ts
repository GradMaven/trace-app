import {
  BENCHMARK_METRICS,
  compareToBenchmark,
  computeBenchmarkBuckets,
  isBenchmarkSector,
  type BenchmarkBucketStat,
  type BenchmarkComparison,
  type BenchmarkContribution,
  type BenchmarkMetric,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { writeAuditLog } from './audit';
import { withOrgContext, type PrismaClient, type TenantDb } from './client';

/**
 * Cross-tenant benchmarking (Phase 14d). Each org opts in and self-declares a
 * coarse `sector`; a platform job (`refreshBenchmarkBuckets`) iterates the
 * opted-in orgs **through their own tenant context**, computes a handful of
 * data-quality ratios from that org's carbon graph / PCFs, and writes
 * k-anonymised sector aggregates to the global `benchmark_bucket` table. The
 * read (`benchmarkComparison`) returns only the aggregate for the caller's own
 * sector plus the caller's own value.
 */

// ---------------------------------------------------------------------------
// Per-org settings
// ---------------------------------------------------------------------------

export interface BenchmarkSettingsView {
  sector: string | null;
  optIn: boolean;
}

export async function getBenchmarkSettings(
  db: TenantDb,
  organizationId: string,
): Promise<BenchmarkSettingsView> {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { sector: true, benchmarkOptIn: true },
  });
  return { sector: org.sector, optIn: org.benchmarkOptIn };
}

export async function setBenchmarkSettings(
  db: TenantDb,
  args: {
    organizationId: string;
    sector: string | null;
    optIn: boolean;
    actorUserId: string;
    requestId: string;
  },
): Promise<void> {
  const sector = args.sector?.trim() || null;
  if (sector && !isBenchmarkSector(sector)) {
    throw AppError.unprocessable('benchmark.bad_sector', `Unknown sector "${sector}".`);
  }
  if (args.optIn && !sector) {
    throw AppError.unprocessable(
      'benchmark.sector_required',
      'Set a sector before opting in to benchmarking.',
    );
  }
  const before = await db.organization.findUniqueOrThrow({
    where: { id: args.organizationId },
    select: { sector: true, benchmarkOptIn: true },
  });
  await db.organization.update({
    where: { id: args.organizationId },
    data: { sector, benchmarkOptIn: args.optIn },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'benchmark.settings_updated',
    resourceType: 'organization',
    resourceId: args.organizationId,
    before: { sector: before.sector, optIn: before.benchmarkOptIn },
    after: { sector, optIn: args.optIn },
    requestId: args.requestId,
  });
}

// ---------------------------------------------------------------------------
// An org's contribution (computed from its own data)
// ---------------------------------------------------------------------------

export async function orgBenchmarkContribution(
  db: TenantDb,
  organizationId: string,
): Promise<BenchmarkContribution | null> {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { sector: true },
  });
  if (!org.sector) return null;

  const values: Partial<Record<BenchmarkMetric, number>> = {};

  const snap = await db.carbonGraphSnapshot.findFirst({
    where: { organizationId },
    orderBy: { version: 'desc' },
    select: { attributedPct: true, data: true },
  });
  if (snap) {
    values.primary_data_share_pct = snap.attributedPct;
    const totals = (snap.data as { graph?: { totals?: { evidenceBackedPct?: unknown } } })?.graph
      ?.totals;
    if (totals && typeof totals.evidenceBackedPct === 'number') {
      values.evidence_backed_pct = Math.round(totals.evidenceBackedPct);
    }
  }

  const pcfRows = await db.pcfRecord.findMany({
    where: { organizationId },
    orderBy: [{ productId: 'asc' }, { version: 'desc' }],
    distinct: ['productId'],
    select: { primaryDataSharePct: true },
  });
  if (pcfRows.length > 0) {
    const avg = pcfRows.reduce((a, r) => a + r.primaryDataSharePct, 0) / pcfRows.length;
    values.pcf_primary_data_share_pct = Math.round(avg);
  }

  return Object.keys(values).length > 0 ? { sector: org.sector, values } : null;
}

// ---------------------------------------------------------------------------
// The platform refresh job
// ---------------------------------------------------------------------------

/** ISO-week label, e.g. `2026-W37`. */
export function benchmarkPeriod(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface BenchmarkRefreshResult {
  period: string;
  contributingOrgs: number;
  buckets: number;
  suppressed: number;
}

export async function refreshBenchmarkBuckets(
  prisma: PrismaClient,
  opts: { period?: string; now?: Date } = {},
): Promise<BenchmarkRefreshResult> {
  const period = opts.period ?? benchmarkPeriod(opts.now);
  // `organization` is not RLS'd — a plain read of the opted-in orgs.
  const orgs = await prisma.organization.findMany({
    where: { benchmarkOptIn: true, sector: { not: null } },
    select: { id: true },
  });

  const contributions: BenchmarkContribution[] = [];
  for (const { id } of orgs) {
    const c = await withOrgContext(id, (db) => orgBenchmarkContribution(db, id), prisma).catch(
      () => null,
    );
    if (c) contributions.push(c);
  }

  const stats = computeBenchmarkBuckets(contributions, { period });
  for (const s of stats) {
    await prisma.benchmarkBucket.upsert({
      where: { sector_metric_period: { sector: s.sector, metric: s.metric, period } },
      create: {
        sector: s.sector,
        metric: s.metric,
        period,
        contributors: s.contributors,
        suppressed: s.suppressed,
        p25: s.p25,
        median: s.median,
        p75: s.p75,
        min: s.min,
        max: s.max,
      },
      update: {
        contributors: s.contributors,
        suppressed: s.suppressed,
        p25: s.p25,
        median: s.median,
        p75: s.p75,
        min: s.min,
        max: s.max,
        computedAt: new Date(),
      },
    });
  }

  return {
    period,
    contributingOrgs: contributions.length,
    buckets: stats.length,
    suppressed: stats.filter((s) => s.suppressed).length,
  };
}

// ---------------------------------------------------------------------------
// The read for a single org
// ---------------------------------------------------------------------------

export interface BenchmarkComparisonView {
  eligible: boolean;
  reason: string | null;
  sector: string | null;
  optIn: boolean;
  period: string | null;
  contributors: number | null;
  metrics: BenchmarkComparison[];
}

function bucketRowToStat(row: {
  sector: string;
  metric: string;
  period: string;
  contributors: number;
  suppressed: boolean;
  p25: { toString(): string } | null;
  median: { toString(): string } | null;
  p75: { toString(): string } | null;
  min: { toString(): string } | null;
  max: { toString(): string } | null;
}): BenchmarkBucketStat {
  const num = (d: { toString(): string } | null): number | null => (d == null ? null : Number(d));
  return {
    sector: row.sector,
    metric: row.metric as BenchmarkMetric,
    period: row.period,
    contributors: row.contributors,
    suppressed: row.suppressed,
    p25: num(row.p25),
    median: num(row.median),
    p75: num(row.p75),
    min: num(row.min),
    max: num(row.max),
  };
}

export async function benchmarkComparison(
  db: TenantDb,
  organizationId: string,
  period?: string,
): Promise<BenchmarkComparisonView> {
  const settings = await getBenchmarkSettings(db, organizationId);
  if (!settings.sector) {
    return {
      eligible: false,
      reason: 'no_sector',
      sector: null,
      optIn: settings.optIn,
      period: null,
      contributors: null,
      metrics: [],
    };
  }

  const own = await orgBenchmarkContribution(db, organizationId);

  const p =
    period ??
    (
      await db.benchmarkBucket.findFirst({
        where: { sector: settings.sector },
        orderBy: { period: 'desc' },
        select: { period: true },
      })
    )?.period ??
    null;

  const rows = p
    ? await db.benchmarkBucket.findMany({ where: { sector: settings.sector, period: p } })
    : [];
  const statByMetric = new Map<string, BenchmarkBucketStat>();
  for (const r of rows) statByMetric.set(r.metric, bucketRowToStat(r));

  const metrics = BENCHMARK_METRICS.map((m) =>
    compareToBenchmark(own?.values[m] ?? null, statByMetric.get(m) ?? null, m),
  );
  const publishedContributors = rows.find((r) => !r.suppressed)?.contributors ?? null;

  return {
    eligible: true,
    reason: p ? null : 'no_data',
    sector: settings.sector,
    optIn: settings.optIn,
    period: p,
    contributors: publishedContributors,
    metrics,
  };
}
