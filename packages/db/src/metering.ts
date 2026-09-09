import {
  billingPeriodKey,
  crossedSoftWarn,
  DEFAULT_PLAN_KEY,
  evaluateMetric,
  evaluateUsage,
  getPlan,
  isPlanKey,
  isUsageMetric,
  PLAN_TIERS,
  USAGE_METRIC_KEYS,
  type EvaluatedMetric,
  type UsageMetric,
  type UsageState,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { type Prisma } from '@prisma/client';
import { writeAuditLog } from './audit';
import { type PrismaClient, type TenantDb } from './client';

/**
 * Usage metering & plan quotas (Phase 13c). Counters are period-bucketed
 * (`YYYY-MM`) and upserted on the hot path; a plan sets a monthly quota per
 * metric. Pure catalogue / evaluation is in `@trace/domain/access/metering`.
 * `subscription` / `usage_counter` / `usage_event` are RLS-forced; `plan` is the
 * global catalogue.
 */

// ---------------------------------------------------------------------------
// Plan catalogue + subscription
// ---------------------------------------------------------------------------

/** Idempotent upsert of the plan catalogue from @trace/domain. */
export async function loadPlans(db: TenantDb): Promise<{ count: number }> {
  for (const p of PLAN_TIERS) {
    await db.plan.upsert({
      where: { key: p.key },
      create: {
        key: p.key,
        name: p.name,
        quotas: p.quotas as unknown as Prisma.InputJsonValue,
        softWarnPct: p.softWarnPct,
        isDefault: !!p.isDefault,
      },
      update: {
        name: p.name,
        quotas: p.quotas as unknown as Prisma.InputJsonValue,
        softWarnPct: p.softWarnPct,
        isDefault: !!p.isDefault,
      },
    });
  }
  return { count: PLAN_TIERS.length };
}

export interface SubscriptionView {
  organizationId: string;
  planKey: string;
  status: string;
  currentPeriod: string;
  startedAt: string;
}

/**
 * Get-or-create the org's subscription, rolling `currentPeriod` forward to the
 * live billing period if it is stale.
 */
export async function ensureSubscription(
  db: TenantDb,
  organizationId: string,
  now: Date = new Date(),
): Promise<SubscriptionView> {
  const period = billingPeriodKey(now);
  const existing = await db.subscription.findUnique({ where: { organizationId } });
  if (!existing) {
    const created = await db.subscription.create({
      data: { organizationId, planKey: DEFAULT_PLAN_KEY, currentPeriod: period },
    });
    return toSubView(created);
  }
  if (existing.currentPeriod !== period) {
    const updated = await db.subscription.update({
      where: { organizationId },
      data: { currentPeriod: period },
    });
    return toSubView(updated);
  }
  return toSubView(existing);
}

function toSubView(r: {
  organizationId: string;
  planKey: string;
  status: string;
  currentPeriod: string;
  startedAt: Date;
}): SubscriptionView {
  return {
    organizationId: r.organizationId,
    planKey: r.planKey,
    status: r.status,
    currentPeriod: r.currentPeriod,
    startedAt: r.startedAt.toISOString(),
  };
}

export async function setPlan(
  db: TenantDb,
  args: {
    organizationId: string;
    planKey: string;
    actorUserId: string;
    requestId: string;
    now?: Date;
  },
): Promise<SubscriptionView> {
  if (!isPlanKey(args.planKey)) {
    throw AppError.unprocessable('billing.unknown_plan', `Unknown plan "${args.planKey}".`);
  }
  const before = await db.subscription.findUnique({
    where: { organizationId: args.organizationId },
  });
  const row = await db.subscription.upsert({
    where: { organizationId: args.organizationId },
    create: {
      organizationId: args.organizationId,
      planKey: args.planKey,
      currentPeriod: billingPeriodKey(args.now ?? new Date()),
    },
    update: { planKey: args.planKey },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'billing.plan_changed',
    resourceType: 'subscription',
    resourceId: args.organizationId,
    before: before ? { planKey: before.planKey } : null,
    after: { planKey: args.planKey },
    requestId: args.requestId,
  });
  return toSubView(row);
}

// ---------------------------------------------------------------------------
// Recording usage
// ---------------------------------------------------------------------------

export interface RecordUsageArgs {
  organizationId: string;
  metric: UsageMetric | string;
  quantity?: number;
  route?: string;
  actorUserId?: string | null;
  requestId?: string;
  now?: Date;
}

export interface RecordUsageResult {
  metric: string;
  period: string;
  value: number;
  crossedWarn: boolean;
}

/**
 * Increment the period counter for `metric` and, for non-`api_request` metrics,
 * append a `usage_event`. If the write crosses the plan's soft-warn threshold,
 * emit a `usage.threshold_reached` audit entry (which fans out to webhooks).
 * `db` must be a tenant transaction.
 */
export async function recordUsage(db: TenantDb, args: RecordUsageArgs): Promise<RecordUsageResult> {
  const metric = args.metric;
  const quantity = args.quantity ?? 1;
  const now = args.now ?? new Date();
  const period = billingPeriodKey(now);

  const counter = await db.usageCounter.upsert({
    where: {
      organizationId_period_metric: { organizationId: args.organizationId, period, metric },
    },
    create: {
      organizationId: args.organizationId,
      period,
      metric,
      value: quantity,
      lastEventAt: now,
    },
    update: { value: { increment: quantity }, lastEventAt: now },
  });

  if (isUsageMetric(metric) && metric !== 'api_request') {
    await db.usageEvent.create({
      data: {
        organizationId: args.organizationId,
        period,
        metric,
        quantity,
        route: args.route ?? null,
      },
    });
  }

  let crossedWarn = false;
  if (isUsageMetric(metric)) {
    const sub = await db.subscription.findUnique({
      where: { organizationId: args.organizationId },
    });
    const plan = getPlan(sub?.planKey ?? DEFAULT_PLAN_KEY);
    const prev = counter.value - quantity;
    if (crossedSoftWarn(plan, metric, prev, counter.value)) {
      crossedWarn = true;
      await writeAuditLog(db, {
        organizationId: args.organizationId,
        actorId: args.actorUserId ?? null,
        action: 'usage.threshold_reached',
        resourceType: 'usage_counter',
        resourceId: `${period}:${metric}`,
        before: null,
        after: {
          metric,
          period,
          used: counter.value,
          quota: plan.quotas[metric] ?? null,
          plan: plan.key,
        },
        requestId: args.requestId ?? 'usage',
      });
    }
  }

  return { metric, period, value: counter.value, crossedWarn };
}

/** Hot-path helper for the API interceptor: bump `api_request`, no event row. */
export async function recordApiRequest(
  prisma: PrismaClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  const period = billingPeriodKey(now);
  await prisma.usageCounter
    .upsert({
      where: { organizationId_period_metric: { organizationId, period, metric: 'api_request' } },
      create: { organizationId, period, metric: 'api_request', value: 1, lastEventAt: now },
      update: { value: { increment: 1 }, lastEventAt: now },
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Reading + enforcement
// ---------------------------------------------------------------------------

async function countersForPeriod(
  db: TenantDb,
  organizationId: string,
  period: string,
): Promise<Partial<Record<UsageMetric, number>>> {
  const rows = await db.usageCounter.findMany({ where: { organizationId, period } });
  const out: Partial<Record<UsageMetric, number>> = {};
  for (const r of rows) {
    if (isUsageMetric(r.metric)) out[r.metric] = r.value;
  }
  // `seats` is a live gauge, not an incrementing counter.
  out.seats = await db.membership.count({
    where: { organizationId, status: 'active', supplierId: null },
  });
  return out;
}

export interface CurrentUsage {
  subscription: SubscriptionView;
  plan: {
    key: string;
    name: string;
    quotas: Partial<Record<UsageMetric, number>>;
    softWarnPct: number;
  };
  period: string;
  metrics: EvaluatedMetric[];
}

export async function currentUsage(
  db: TenantDb,
  organizationId: string,
  period?: string,
): Promise<CurrentUsage> {
  const sub = await ensureSubscription(db, organizationId);
  const p = period ?? sub.currentPeriod;
  const plan = getPlan(sub.planKey);
  const counters = await countersForPeriod(db, organizationId, p);
  return {
    subscription: sub,
    plan: { key: plan.key, name: plan.name, quotas: plan.quotas, softWarnPct: plan.softWarnPct },
    period: p,
    metrics: evaluateUsage(plan, counters),
  };
}

export interface QuotaCheck {
  metric: string;
  allowed: boolean;
  state: UsageState;
  used: number;
  quota: number | null;
}

/** Is the org under quota for `metric` in the current period? */
export async function checkQuota(
  db: TenantDb,
  organizationId: string,
  metric: UsageMetric,
): Promise<QuotaCheck> {
  const sub = await ensureSubscription(db, organizationId);
  const plan = getPlan(sub.planKey);
  const row = await db.usageCounter.findUnique({
    where: { organizationId_period_metric: { organizationId, period: sub.currentPeriod, metric } },
  });
  const used = row?.value ?? 0;
  const evald = evaluateMetric(plan, metric, used);
  return {
    metric,
    allowed: evald.quota == null || used < evald.quota,
    state: evald.state,
    used,
    quota: evald.quota,
  };
}

export function listPlans(): typeof PLAN_TIERS {
  return PLAN_TIERS;
}

export { USAGE_METRIC_KEYS };
