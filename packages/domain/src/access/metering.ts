/**
 * Usage metering & plan quotas (Phase 13c) — pure.
 *
 * The API records a counter per billing period (YYYY-MM) for a small set of
 * metrics; a plan sets a quota per metric. This module owns the metric
 * catalogue, the plan tiers (versioned data, loaded into the `plan` table), the
 * period key, and the pure evaluation (`ok` / `warn` / `over`).
 */

export const USAGE_METRICS = {
  api_request: { label: 'API requests', kind: 'counter', unit: 'requests' },
  ai_job: { label: 'AI extraction jobs', kind: 'counter', unit: 'jobs' },
  calculation_run: { label: 'Calculation runs', kind: 'counter', unit: 'runs' },
  export_job: { label: 'Data exports', kind: 'counter', unit: 'exports' },
  seats: { label: 'Active members', kind: 'gauge', unit: 'seats' },
} as const;

export type UsageMetric = keyof typeof USAGE_METRICS;

export const USAGE_METRIC_KEYS = Object.keys(USAGE_METRICS) as UsageMetric[];

/** Metrics the API enforces a hard 429 on when the quota is exceeded. */
export const ENFORCED_METRICS: readonly UsageMetric[] = ['ai_job', 'calculation_run', 'export_job'];

export function isUsageMetric(value: string): value is UsageMetric {
  return value in USAGE_METRICS;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface PlanTier {
  key: string;
  name: string;
  /** Per-metric monthly quota. A metric absent from the map is unlimited. */
  quotas: Partial<Record<UsageMetric, number>>;
  /** Warn (not block) once usage reaches this percentage of quota. */
  softWarnPct: number;
  isDefault?: boolean;
}

export const PLAN_TIERS: PlanTier[] = [
  {
    key: 'free',
    name: 'Free',
    quotas: { api_request: 20_000, ai_job: 50, calculation_run: 500, export_job: 3, seats: 3 },
    softWarnPct: 80,
    isDefault: true,
  },
  {
    key: 'growth',
    name: 'Growth',
    quotas: {
      api_request: 500_000,
      ai_job: 2_000,
      calculation_run: 25_000,
      export_job: 30,
      seats: 25,
    },
    softWarnPct: 85,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    // No quotas — everything unlimited. Still metered for visibility + billing.
    quotas: {},
    softWarnPct: 90,
  },
];

const PLAN_BY_KEY = new Map(PLAN_TIERS.map((p) => [p.key, p]));

export const DEFAULT_PLAN_KEY = (PLAN_TIERS.find((p) => p.isDefault) ?? PLAN_TIERS[0]!).key;

export function getPlan(key: string): PlanTier {
  return PLAN_BY_KEY.get(key) ?? PLAN_BY_KEY.get(DEFAULT_PLAN_KEY)!;
}

export function isPlanKey(key: string): boolean {
  return PLAN_BY_KEY.has(key);
}

// ---------------------------------------------------------------------------
// Billing period
// ---------------------------------------------------------------------------

/** `YYYY-MM` in UTC — the monthly usage bucket. */
export function billingPeriodKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function billingPeriodBounds(key: string): { start: Date; end: Date } {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type UsageState = 'ok' | 'warn' | 'over';

export interface EvaluatedMetric {
  metric: UsageMetric;
  label: string;
  kind: 'counter' | 'gauge';
  used: number;
  quota: number | null;
  pct: number | null;
  state: UsageState;
}

export function evaluateMetric(plan: PlanTier, metric: UsageMetric, used: number): EvaluatedMetric {
  const def = USAGE_METRICS[metric];
  const quota = plan.quotas[metric] ?? null;
  if (quota == null || quota <= 0) {
    return { metric, label: def.label, kind: def.kind, used, quota: null, pct: null, state: 'ok' };
  }
  const pct = Math.round((used / quota) * 1000) / 10;
  const state: UsageState = used >= quota ? 'over' : pct >= plan.softWarnPct ? 'warn' : 'ok';
  return { metric, label: def.label, kind: def.kind, used, quota, pct, state };
}

export function evaluateUsage(
  plan: PlanTier,
  counters: Partial<Record<UsageMetric, number>>,
): EvaluatedMetric[] {
  return USAGE_METRIC_KEYS.map((m) => evaluateMetric(plan, m, counters[m] ?? 0));
}

/** True when adding `increment` to `current` would exceed the plan's quota for `metric`. */
export function wouldExceedQuota(
  plan: PlanTier,
  metric: UsageMetric,
  current: number,
  increment = 1,
): boolean {
  const quota = plan.quotas[metric];
  if (quota == null || quota <= 0) return false;
  return current + increment > quota;
}

/** True when `prev < threshold` but `next >= threshold` — i.e. this write crossed the soft-warn line. */
export function crossedSoftWarn(
  plan: PlanTier,
  metric: UsageMetric,
  prev: number,
  next: number,
): boolean {
  const quota = plan.quotas[metric];
  if (quota == null || quota <= 0) return false;
  const threshold = (quota * plan.softWarnPct) / 100;
  return prev < threshold && next >= threshold;
}
