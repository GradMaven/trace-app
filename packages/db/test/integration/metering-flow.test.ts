import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingPeriodKey } from '@trace/domain';
import {
  checkQuota,
  createPrisma,
  currentUsage,
  exportAuditLog,
  provisionOrganization,
  queryAuditLog,
  recordUsage,
  setPlan,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('metering: usage counters, quotas, plans + audit-log egress', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const period = billingPeriodKey();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `ma-${userA}@test.example`, name: 'A' },
        { id: userB, email: `mb-${userB}@test.example`, name: 'B' },
      ],
    });
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ] as const) {
      await withOrgContext(
        org,
        (db) =>
          provisionOrganization(db, {
            organizationId: org,
            slug: `m-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('provisions a default subscription and a zeroed current period', async () => {
    const usage = await withOrgContext(orgA, (db) => currentUsage(db, orgA), prisma);
    expect(usage.plan.key).toBe('free');
    expect(usage.period).toBe(period);
    const ai = usage.metrics.find((m) => m.metric === 'ai_job')!;
    expect(ai).toMatchObject({ used: 0, quota: 50, state: 'ok' });
    // seats is a live gauge — the creator counts as one
    expect(usage.metrics.find((m) => m.metric === 'seats')!.used).toBe(1);
  });

  it('increments the period counter and appends usage events for non-request metrics', async () => {
    for (let i = 0; i < 3; i += 1) {
      const r = await withOrgContext(
        orgA,
        (db) => recordUsage(db, { organizationId: orgA, metric: 'ai_job', requestId: 'test' }),
        prisma,
      );
      expect(r.value).toBe(i + 1);
    }
    const [usage, events] = await withOrgContext(
      orgA,
      async (db) => [
        await currentUsage(db, orgA),
        await db.usageEvent.count({ where: { organizationId: orgA, metric: 'ai_job' } }),
      ],
      prisma,
    );
    expect(usage.metrics.find((m) => m.metric === 'ai_job')!.used).toBe(3);
    expect(events).toBe(3);
  });

  it('buckets by billing period', async () => {
    await withOrgContext(
      orgA,
      (db) =>
        recordUsage(db, {
          organizationId: orgA,
          metric: 'ai_job',
          now: new Date('2024-01-15T00:00:00Z'),
          requestId: 'test',
        }),
      prisma,
    );
    const rows = await withOrgContext(
      orgA,
      (db) => db.usageCounter.findMany({ where: { organizationId: orgA, metric: 'ai_job' } }),
      prisma,
    );
    const byPeriod = Object.fromEntries(rows.map((r) => [r.period, r.value]));
    expect(byPeriod['2024-01']).toBe(1);
    expect(byPeriod[period]).toBe(3);
  });

  it('emits a usage.threshold_reached audit entry on the soft-warn crossing', async () => {
    // free plan: ai_job quota 50, softWarn 80% => threshold 40. Nudge to 39 first.
    await withOrgContext(
      orgA,
      (db) =>
        db.usageCounter.update({
          where: {
            organizationId_period_metric: { organizationId: orgA, period, metric: 'ai_job' },
          },
          data: { value: 39 },
        }),
      prisma,
    );
    const crossed = await withOrgContext(
      orgA,
      (db) => recordUsage(db, { organizationId: orgA, metric: 'ai_job', requestId: 'test' }),
      prisma,
    );
    expect(crossed).toMatchObject({ value: 40, crossedWarn: true });

    const warnEntries = await withOrgContext(
      orgA,
      (db) => queryAuditLog(db, orgA, { actionPrefix: 'usage.threshold_reached' }, { limit: 5 }),
      prisma,
    );
    expect(warnEntries.data.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces a quota with checkQuota', async () => {
    for (let i = 0; i < 3; i += 1) {
      await withOrgContext(
        orgA,
        (db) => recordUsage(db, { organizationId: orgA, metric: 'export_job', requestId: 'test' }),
        prisma,
      );
    }
    const check = await withOrgContext(orgA, (db) => checkQuota(db, orgA, 'export_job'), prisma);
    expect(check).toMatchObject({ allowed: false, state: 'over', used: 3, quota: 3 });
  });

  it('switches the plan and re-evaluates against the new quotas', async () => {
    const sub = await withOrgContext(
      orgA,
      (db) =>
        setPlan(db, {
          organizationId: orgA,
          planKey: 'growth',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(sub.planKey).toBe('growth');
    const [usage, check] = await withOrgContext(
      orgA,
      async (db) => [await currentUsage(db, orgA), await checkQuota(db, orgA, 'export_job')],
      prisma,
    );
    expect(usage.plan.key).toBe('growth');
    expect(usage.metrics.find((m) => m.metric === 'export_job')!.quota).toBe(30);
    expect(check.allowed).toBe(true); // 3 of 30 now
  });

  it('exports the activity log as NDJSON, filtered and tenant-scoped', async () => {
    const all = await withOrgContext(
      orgA,
      (db) => db.auditLog.count({ where: { organizationId: orgA } }),
      prisma,
    );
    const dump = await withOrgContext(orgA, (db) => exportAuditLog(db, orgA, {}), prisma);
    expect(dump.rows).toBe(all);
    const lines = dump.ndjson.trim().split('\n');
    expect(lines).toHaveLength(all);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(lines[0]!).organizationId).toBe(orgA);

    const billing = await withOrgContext(
      orgA,
      (db) => queryAuditLog(db, orgA, { actionPrefix: 'billing.' }, { limit: 10 }),
      prisma,
    );
    expect(billing.data.every((r) => r.action.startsWith('billing.'))).toBe(true);
    expect(billing.data.some((r) => r.action === 'billing.plan_changed')).toBe(true);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bUsage = await withOrgContext(orgB, (db) => currentUsage(db, orgB), prisma);
    expect(bUsage.plan.key).toBe('free');
    expect(bUsage.metrics.every((m) => m.metric === 'seats' || m.used === 0)).toBe(true);

    const bCounters = await withOrgContext(orgB, (db) => db.usageCounter.count(), prisma);
    expect(bCounters).toBe(0);

    const bDump = await withOrgContext(orgB, (db) => exportAuditLog(db, orgB, {}), prisma);
    expect(bDump.ndjson).not.toContain(orgA);
  });
});
