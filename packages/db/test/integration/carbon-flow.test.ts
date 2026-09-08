import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrisma,
  inventorySummary,
  provisionOrganization,
  recomputeCalculation,
  recomputeEmissions,
  reproduceCalculation,
  runCalculation,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('carbon engine: activity → calculation → emission', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let activityId = '';
  let calculationId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `ca-${userA}@test.example`, name: 'A' },
        { id: userB, email: `cb-${userB}@test.example`, name: 'B' },
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
            slug: `c-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    // A shared-library factor (org-null) is not RLS-protected.
    await prisma.emissionFactor.create({
      data: {
        organizationId: null,
        source: 'TEST',
        sourceRef: 'steel',
        name: 'steel',
        value: '2.1',
        numeratorUnit: 'tCO2e',
        denominatorUnit: 't',
        activityDimension: 'mass',
        scope: 'scope_3',
        ghgCategory: 'cat_1_purchased_goods_services',
        geography: 'DE',
        methodology: 'average_data',
        validFrom: new Date('2024-01-01'),
      },
    });

    activityId = await withOrgContext(
      orgA,
      async (db) => {
        const a = await db.activityData.create({
          data: {
            organizationId: orgA,
            scope: 'scope_3',
            ghgCategory: 'cat_1_purchased_goods_services',
            category: 'steel',
            value: '1283',
            unit: 't',
            reportingPeriod: 'FY2025',
            provenance: 'supplier_reported',
            subjectType: 'organization',
            subjectId: orgA,
            occurredOn: new Date('2025-12-31'),
            createdByUserId: userA,
          },
        });
        return a.id;
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('runs a deterministic calculation (1283 t × 2.1 tCO2e/t = 2694.3)', async () => {
    const result = await withOrgContext(
      orgA,
      (db) =>
        runCalculation(db, {
          organizationId: orgA,
          activityId,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    calculationId = result.calculationId;
    expect(result.resultValueTco2e).toBe('2694.3');
  });

  it('reproduces the stored result exactly', async () => {
    const r = await withOrgContext(
      orgA,
      (db) => reproduceCalculation(db, orgA, calculationId),
      prisma,
    );
    expect(r.reproduced).toBe(true);
    expect(r.recomputedResult).toBe('2694.3');
  });

  it('produces a calculated datapoint', async () => {
    const dps = await withOrgContext(
      orgA,
      (db) => db.datapoint.findMany({ where: { calculationId } }),
      prisma,
    );
    expect(dps).toHaveLength(1);
    expect(dps[0]!.provenance).toBe('calculated');
    expect(dps[0]!.valueNumeric?.toString()).toBe('2694.3');
  });

  it('rolls up into the FY2025 emission inventory', async () => {
    await withOrgContext(
      orgA,
      (db) =>
        recomputeEmissions(db, {
          organizationId: orgA,
          reportingPeriod: 'FY2025',
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const summary = await withOrgContext(
      orgA,
      (db) => inventorySummary(db, orgA, 'FY2025'),
      prisma,
    );
    expect(summary.scope3).toBe('2694.3');
    expect(summary.total).toBe('2694.3');
  });

  it('recompute re-selects an org-specific factor and freezes the old row', async () => {
    await withOrgContext(
      orgA,
      (db) =>
        db.emissionFactor.create({
          data: {
            organizationId: orgA,
            source: 'CUSTOM',
            sourceRef: 'steel-specific',
            name: 'supplier steel',
            value: '2.05',
            numeratorUnit: 'tCO2e',
            denominatorUnit: 't',
            activityDimension: 'mass',
            scope: 'scope_3',
            ghgCategory: 'cat_1_purchased_goods_services',
            geography: 'DE',
            methodology: 'supplier_specific',
            validFrom: new Date('2025-01-01'),
            createdByUserId: userA,
          },
        }),
      prisma,
    );
    const next = await withOrgContext(
      orgA,
      (db) =>
        recomputeCalculation(db, {
          organizationId: orgA,
          calculationId,
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(next.resultValueTco2e).toBe('2630.15'); // 1283 * 2.05
    const oldCalc = await withOrgContext(
      orgA,
      (db) => db.calculation.findUnique({ where: { id: calculationId }, include: { supersededBy: true } }),
      prisma,
    );
    expect(oldCalc?.resultValueTco2e.toString()).toBe('2694.3'); // unchanged
    expect(oldCalc?.supersededBy).toHaveLength(1);
  });

  it('keeps a verifiable audit chain', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('does not leak carbon data across tenants (RLS)', async () => {
    const counts = await withOrgContext(
      orgB,
      async (db) => ({
        activity: await db.activityData.count(),
        calc: await db.calculation.count(),
        emission: await db.emission.count(),
      }),
      prisma,
    );
    expect(counts).toEqual({ activity: 0, calc: 0, emission: 0 });
  });
});
