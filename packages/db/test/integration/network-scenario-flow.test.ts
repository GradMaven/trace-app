import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeCarbonGraph,
  createPrisma,
  listNetworkScenarios,
  networkScenarioById,
  previewNetworkScenario,
  provisionOrganization,
  runNetworkScenario,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
  type TenantDb,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;
const PERIOD = 'FY2024';

async function makeSupplier(
  db: TenantDb,
  organizationId: string,
  creator: string,
  name: string,
  tco2e: number,
): Promise<string> {
  const s = await db.supplier.create({
    data: {
      organizationId,
      name,
      country: 'DE',
      createdByUserId: creator,
      relationship: { create: { organizationId, annualSpend: 1_000_000, tier: 1, currency: 'EUR' } },
    },
  });
  await db.datapoint.create({
    data: {
      organizationId,
      metricKey: 'emission_scope3_cat1',
      valueNumeric: tco2e,
      unit: 'tCO2e',
      provenance: 'supplier_reported',
      reportingPeriod: PERIOD,
      subjectType: 'supplier',
      subjectId: s.id,
      createdByUserId: creator,
    },
  });
  return s.id;
}

run('Carbon Twin: network scenario engine', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let steelId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `nsa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `nsb-${userB}@test.example`, name: 'B' },
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
            slug: `ns-${org.slice(0, 8)}`,
            legalName: 'NetCo',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }
    await withOrgContext(
      orgA,
      async (db) => {
        steelId = await makeSupplier(db, orgA, userA, 'Steel', 800);
        await makeSupplier(db, orgA, userA, 'Bearings', 150);
        await makeSupplier(db, orgA, userA, 'Sensors', 50);
        await computeCarbonGraph(db, {
          organizationId: orgA,
          reportingPeriod: PERIOD,
          computedByUserId: userA,
          requestId: 'test',
        });
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('previews a decarbonisation against the latest graph', async () => {
    const { result, baseGraphVersion } = await withOrgContext(
      orgA,
      (db) =>
        previewNetworkScenario(db, {
          organizationId: orgA,
          interventions: [{ id: 'i1', kind: 'decarbonize', nodeId: steelId, reductionPct: 25 }],
        }),
      prisma,
    );
    expect(baseGraphVersion).toBe(1);
    expect(result.baseline.totalTco2e).toBe(1000);
    expect(result.projected.totalTco2e).toBe(800); // steel 800 → 600
    expect(result.deltaTco2e).toBe(-200);
    expect(result.deltaPct).toBe(-20);
    expect(result.appliedInterventions[0]!.ok).toBe(true);
    const steelDelta = result.nodeDeltas.find((d) => d.id === steelId)!;
    expect(steelDelta.deltaTco2e).toBe(-200);
  });

  it('saves an immutable scenario record', async () => {
    const { id, result } = await withOrgContext(
      orgA,
      (db) =>
        runNetworkScenario(db, {
          organizationId: orgA,
          name: 'Steel −25%',
          interventions: [{ id: 'i1', kind: 'decarbonize', nodeId: steelId, reductionPct: 25 }],
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(result.deltaTco2e).toBe(-200);

    const list = await withOrgContext(orgA, (db) => listNetworkScenarios(db, orgA), prisma);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Steel −25%');

    const detail = await withOrgContext(orgA, (db) => networkScenarioById(db, orgA, id), prisma);
    expect(Number(detail.projectedTco2e)).toBe(800);
    expect(detail.interventions).toHaveLength(1);
  });

  it('rejects an empty intervention set', async () => {
    await expect(
      withOrgContext(
        orgA,
        (db) =>
          runNetworkScenario(db, {
            organizationId: orgA,
            name: 'empty',
            interventions: [],
            actorUserId: userA,
            requestId: 'test',
          }),
        prisma,
      ),
    ).rejects.toThrow(/at least one intervention/i);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);
    const bCount = await withOrgContext(orgB, (db) => db.networkScenario.count(), prisma);
    expect(bCount).toBe(0);
  });
});
