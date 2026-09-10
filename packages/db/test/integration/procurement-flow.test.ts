import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrisma,
  listProcurementScenarios,
  provisionOrganization,
  runCalculation,
  runProcurementScenario,
  scenarioLinesForSuppliers,
  supplierCarbonComparison,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('procurement: supplier carbon comparison + what-if scenario', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const supA = randomUUID();
  const supB = randomUUID();
  const supC = randomUUID();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `pa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `pb-${userB}@test.example`, name: 'B' },
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
            slug: `p-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    // Org-scoped, not shared-library: `emission_factor` is not RLS-isolated, so
    // an `organizationId: null` factor here would leak into every other
    // integration file's factor selection.
    await prisma.emissionFactor.createMany({
      data: [
        {
          organizationId: orgA,
          source: 'CUSTOM',
          sourceRef: 'steel-specific-p',
          name: 'steel supplier-specific',
          value: '1.8',
          numeratorUnit: 'tCO2e',
          denominatorUnit: 't',
          activityDimension: 'mass',
          scope: 'scope_3',
          ghgCategory: 'cat_1_purchased_goods_services',
          methodology: 'supplier_specific',
          validFrom: new Date('2024-01-01'),
        },
        {
          organizationId: orgA,
          source: 'EXIOBASE',
          sourceRef: 'eeio-eur-p',
          name: 'EEIO purchased goods EUR',
          value: '0.28',
          numeratorUnit: 'kgCO2e',
          denominatorUnit: 'EUR',
          activityDimension: 'currency',
          scope: 'scope_3',
          ghgCategory: 'cat_1_purchased_goods_services',
          methodology: 'spend_based',
          validFrom: new Date('2024-01-01'),
        },
      ],
    });

    await withOrgContext(
      orgA,
      async (db) => {
        await db.organization.update({
          where: { id: orgA },
          data: { reportingPeriodConfig: { activePeriod: 'FY2025' } },
        });

        const mkSupplier = (id: string, name: string, spend: number, tier: number) =>
          db.supplier.create({
            data: {
              id,
              organizationId: orgA,
              name,
              country: 'DE',
              createdByUserId: userA,
              relationship: {
                create: { organizationId: orgA, category: 'Materials', tier, annualSpend: spend },
              },
            },
          });
        await mkSupplier(supA, 'Steel Co', 10_000_000, 1);
        await mkSupplier(supB, 'Poly Co', 5_000_000, 1);
        await mkSupplier(supC, 'Fastener Co', 2_000_000, 2);

        // Supplier A: supplier-specific steel calc.
        const aAct = await db.activityData.create({
          data: {
            organizationId: orgA,
            scope: 'scope_3',
            ghgCategory: 'cat_1_purchased_goods_services',
            category: 'Crude steel',
            value: '1000',
            unit: 't',
            reportingPeriod: 'FY2025',
            provenance: 'supplier_reported',
            subjectType: 'supplier',
            subjectId: supA,
            supplierId: supA,
            occurredOn: new Date('2025-12-31'),
            createdByUserId: userA,
          },
        });
        await runCalculation(db, {
          organizationId: orgA,
          activityId: aAct.id,
          actorUserId: userA,
          requestId: 'test',
        });

        // Suppliers B & C: spend-based EEIO calcs.
        for (const [supId, spend] of [
          [supB, '5000000'],
          [supC, '2000000'],
        ] as const) {
          const act = await db.activityData.create({
            data: {
              organizationId: orgA,
              scope: 'scope_3',
              ghgCategory: 'cat_1_purchased_goods_services',
              category: 'Purchased goods & services',
              value: spend,
              unit: 'EUR',
              reportingPeriod: 'FY2025',
              provenance: 'estimated',
              subjectType: 'supplier',
              subjectId: supId,
              supplierId: supId,
              occurredOn: new Date('2025-12-31'),
              createdByUserId: userA,
            },
          });
          await runCalculation(db, {
            organizationId: orgA,
            activityId: act.id,
            actorUserId: userA,
            requestId: 'test',
          });
        }
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('ranks suppliers by carbon intensity and flags spend-based attribution', async () => {
    const c = await withOrgContext(orgA, (db) => supplierCarbonComparison(db, orgA), prisma);
    expect(c.rows).toHaveLength(3);
    expect(c.totals.withEmissions).toBe(3);

    const steel = c.rows.find((r) => r.supplierId === supA)!;
    const poly = c.rows.find((r) => r.supplierId === supB)!;
    expect(steel.attributionQuality).toBe('supplier_specific');
    expect(poly.attributionQuality).toBe('spend_based');
    expect(poly.flags).toContain('spend-based estimate');
    // 1000 t x 1.8 = 1800 tCO2e / (10,000,000 / 1000) = 0.18
    expect(steel.carbonIntensityPerKEur).toBeCloseTo(0.18, 4);
    // 5,000,000 EUR x 0.28 kg = 1400 tCO2e / 5000 = 0.28
    expect(poly.carbonIntensityPerKEur).toBeCloseTo(0.28, 4);
    expect(poly.intensityRank).toBeLessThan(steel.intensityRank!);
    expect(c.totals.spendBasedShareOfEmissionsPct).toBeGreaterThan(0);
    expect(c.opportunities.some((o) => o.kind === 'refine_data')).toBe(true);
  });

  it('builds scenario lines from real calculations and projects a what-if', async () => {
    const lines = await withOrgContext(
      orgA,
      (db) => scenarioLinesForSuppliers(db, orgA, [supA, supB], 'FY2025'),
      prisma,
    );
    expect(lines).toHaveLength(2);
    const steelLine = lines.find((l) => l.supplierId === supA)!;
    expect(Number(steelLine.activityValue)).toBe(1000);
    expect(steelLine.factorDenominatorUnit).toBe('t');

    const res = await withOrgContext(
      orgA,
      (db) =>
        runProcurementScenario(db, {
          organizationId: orgA,
          name: 'Cut steel 50%, drop Poly Co',
          reportingPeriod: 'FY2025',
          lines,
          changes: [
            { supplierId: supA, activityMultiplier: 0.5 },
            { supplierId: supB, drop: true },
          ],
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(Number(res.result.baselineTco2e)).toBeCloseTo(3200, 0); // 1800 + 1400
    expect(Number(res.result.projectedTco2e)).toBeCloseTo(900, 0); // 900 + 0
    expect(Number(res.result.deltaTco2e)).toBeLessThan(0);

    const row = await withOrgContext(
      orgA,
      (db) => db.procurementScenario.findUnique({ where: { id: res.id } }),
      prisma,
    );
    expect(row?.name).toBe('Cut steel 50%, drop Poly Co');
    expect(Number(row?.deltaTco2e)).toBeCloseTo(Number(res.result.deltaTco2e), 4);

    const list = await withOrgContext(orgA, (db) => listProcurementScenarios(db, orgA), prisma);
    expect(list.some((s) => s.id === res.id)).toBe(true);
  });

  it('keeps a verifiable audit chain', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
  });

  it('does not leak procurement data across tenants (RLS)', async () => {
    const c = await withOrgContext(orgB, (db) => supplierCarbonComparison(db, orgB), prisma);
    expect(c.rows).toEqual([]);
    const count = await withOrgContext(orgB, (db) => db.procurementScenario.count(), prisma);
    expect(count).toBe(0);
  });
});
