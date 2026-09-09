import { billingPeriodKey, heartbeatStatus, type MetricSample } from '@trace/domain';
import { type PrismaClient, type TenantDb } from './client';
import { readHeartbeat } from './audit-stream';

/**
 * Operational stats + Prometheus metrics (Phase 13d).
 *
 * `orgStats` is a per-tenant read composition for the Ops screen. `platformMetrics`
 * is process-wide and only counts tables that are reachable without an org
 * context (`organization`, `user`, `audit_log`, `webhook_delivery`, …) plus the
 * worker heartbeat — per-tenant depth lives in `orgStats`.
 */

export interface OrgStats {
  organizationId: string;
  period: string;
  members: number;
  suppliers: number;
  datapoints: number;
  calculations: number;
  evidence: number;
  auditEntries: number;
  openFindings: number;
  webhookEndpoints: number;
  auditStreams: number;
  apiRequestsThisPeriod: number;
  aiJobsThisPeriod: number;
  worker: { status: string; ageSeconds: number | null };
}

export async function orgStats(
  db: TenantDb,
  organizationId: string,
  now: Date = new Date(),
): Promise<OrgStats> {
  const period = billingPeriodKey(now);
  const [
    members,
    suppliers,
    datapoints,
    calculations,
    evidence,
    auditEntries,
    openFindings,
    webhookEndpoints,
    auditStreams,
    counters,
  ] = await Promise.all([
    db.membership.count({ where: { organizationId, status: 'active' } }),
    db.supplier.count({ where: { organizationId } }),
    db.datapoint.count({ where: { organizationId } }),
    db.calculation.count({ where: { organizationId } }),
    db.evidence.count({ where: { organizationId } }),
    db.auditLog.count({ where: { organizationId } }),
    db.auditFinding.count({
      where: { organizationId, status: { in: ['open', 'acknowledged', 'remediating'] } },
    }),
    db.webhookEndpoint.count({ where: { organizationId } }),
    db.auditStream.count({ where: { organizationId } }),
    db.usageCounter.findMany({ where: { organizationId, period } }),
  ]);

  const byMetric = Object.fromEntries(counters.map((c) => [c.metric, c.value]));
  const hb = await db.componentHeartbeat.findUnique({ where: { component: 'worker' } });
  const workerHb = heartbeatStatus(hb?.beatAt ?? null, now);

  return {
    organizationId,
    period,
    members,
    suppliers,
    datapoints,
    calculations,
    evidence,
    auditEntries,
    openFindings,
    webhookEndpoints,
    auditStreams,
    apiRequestsThisPeriod: byMetric.api_request ?? 0,
    aiJobsThisPeriod: byMetric.ai_job ?? 0,
    worker: { status: workerHb.status, ageSeconds: workerHb.ageSeconds },
  };
}

export async function platformMetrics(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<MetricSample[]> {
  const [
    orgs,
    activeOrgs,
    users,
    auditEntries,
    webhookPending,
    webhookDead,
    streamPending,
    activeStreams,
    subscriptions,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { status: 'active' } }),
    prisma.user.count(),
    prisma.auditLog.count(),
    prisma.webhookDelivery.count({ where: { status: 'pending' } }),
    prisma.webhookDelivery.count({ where: { status: 'dead' } }),
    prisma.auditStreamDelivery.count({ where: { status: { in: ['pending', 'failed'] } } }),
    prisma.auditStream.count({ where: { status: 'active' } }),
    prisma.subscription.groupBy({ by: ['planKey'], _count: { _all: true } }),
  ]);

  const hb = await readHeartbeat(prisma, 'worker');
  const workerAge = hb ? Math.round((now.getTime() - hb.beatAt.getTime()) / 1000) : -1;

  const samples: MetricSample[] = [
    { name: 'trace_organizations_total', help: 'Organizations', type: 'gauge', value: orgs },
    {
      name: 'trace_organizations_active',
      help: 'Active organizations',
      type: 'gauge',
      value: activeOrgs,
    },
    { name: 'trace_users_total', help: 'Users', type: 'gauge', value: users },
    {
      name: 'trace_audit_entries_total',
      help: 'Audit-log entries',
      type: 'counter',
      value: auditEntries,
    },
    {
      name: 'trace_webhook_deliveries',
      help: 'Webhook deliveries by state',
      type: 'gauge',
      value: webhookPending,
      labels: { state: 'pending' },
    },
    {
      name: 'trace_webhook_deliveries',
      help: 'Webhook deliveries by state',
      type: 'gauge',
      value: webhookDead,
      labels: { state: 'dead' },
    },
    {
      name: 'trace_audit_stream_deliveries_pending',
      help: 'Audit-stream deliveries awaiting send',
      type: 'gauge',
      value: streamPending,
    },
    {
      name: 'trace_audit_streams_active',
      help: 'Active audit streams',
      type: 'gauge',
      value: activeStreams,
    },
    {
      name: 'trace_worker_heartbeat_age_seconds',
      help: 'Seconds since the worker last checked in (-1 = never)',
      type: 'gauge',
      value: workerAge,
    },
  ];
  for (const row of subscriptions) {
    samples.push({
      name: 'trace_subscriptions',
      help: 'Subscriptions by plan',
      type: 'gauge',
      value: row._count?._all ?? 0,
      labels: { plan: row.planKey },
    });
  }
  return samples;
}
