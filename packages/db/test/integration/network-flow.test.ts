import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  carbonGraphNodeTrace,
  computeCarbonGraph,
  createPrisma,
  deleteSupplyChainEdge,
  latestCarbonGraph,
  listSupplyChainEdges,
  provisionOrganization,
  upsertSupplyChainEdge,
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
  spend: number,
  tier: number,
): Promise<string> {
  const s = await db.supplier.create({
    data: {
      organizationId,
      name,
      country: 'DE',
      createdByUserId: creator,
      relationship: {
        create: { organizationId, annualSpend: spend, tier, currency: 'EUR' },
      },
    },
  });
  return s.id;
}

async function addEmission(
  db: TenantDb,
  organizationId: string,
  creator: string,
  supplierId: string,
  tco2e: number,
): Promise<void> {
  await db.datapoint.create({
    data: {
      organizationId,
      metricKey: 'emission_scope3_cat1',
      valueNumeric: tco2e,
      unit: 'tCO2e',
      provenance: 'supplier_reported',
      reportingPeriod: PERIOD,
      subjectType: 'supplier',
      subjectId: supplierId,
      createdByUserId: creator,
    },
  });
}

run('Carbon Twin: supply-chain graph', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let steelId = '';
  let bearingsId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `nwa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `nwb-${userB}@test.example`, name: 'B' },
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
            slug: `nw-${org.slice(0, 8)}`,
            legalName: 'NordWerk',
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
        steelId = await makeSupplier(db, orgA, userA, 'Rheinstahl Steel', 2_000_000, 1);
        bearingsId = await makeSupplier(db, orgA, userA, 'Nordic Bearings', 400_000, 1);
        const minor = await makeSupplier(db, orgA, userA, 'Helvetia Sensors', 300_000, 1);
        await addEmission(db, orgA, userA, steelId, 700);
        await addEmission(db, orgA, userA, bearingsId, 150);
        await addEmission(db, orgA, userA, minor, 40);
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('declares an upstream link (external + supplier→supplier)', async () => {
    await withOrgContext(
      orgA,
      async (db) => {
        await upsertSupplyChainEdge(db, {
          organizationId: orgA,
          fromSupplierId: steelId,
          toLabel: 'Iron ore mine',
          relationship: 'raw material',
          actorUserId: userA,
          requestId: 'test',
        });
        await upsertSupplyChainEdge(db, {
          organizationId: orgA,
          fromSupplierId: bearingsId,
          toSupplierId: steelId,
          relationship: 'bearing steel',
          actorUserId: userA,
          requestId: 'test',
        });
      },
      prisma,
    );
    const edges = await withOrgContext(orgA, (db) => listSupplyChainEdges(db, orgA), prisma);
    expect(edges).toHaveLength(2);
    expect(edges.some((e) => e.toLabel === 'Iron ore mine' && e.toSupplierId == null)).toBe(true);
  });

  it('computes a rolled-up graph with a Pareto hotspot ranking', async () => {
    const snap = await withOrgContext(
      orgA,
      (db) =>
        computeCarbonGraph(db, {
          organizationId: orgA,
          reportingPeriod: PERIOD,
          computedByUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(snap.version).toBe(1);
    // bearings rolls up steel's 700 → total 850; steel total 700
    const bearings = snap.graph.nodes.find((n) => n.id === bearingsId)!;
    expect(bearings.upstreamTco2e).toBe(700);
    expect(bearings.totalTco2e).toBe(850);
    expect(snap.hotspots.nodes[0]!.id).toBe(bearingsId);
    expect(snap.hotspots.nodes[0]!.rank).toBe(1);
    expect(snap.hotspots.hotspotCount).toBeGreaterThanOrEqual(1);
    expect(snap.totals.totalTco2e).toBeGreaterThan(0);

    // a second compute chains a new immutable version
    const again = await withOrgContext(
      orgA,
      (db) =>
        computeCarbonGraph(db, {
          organizationId: orgA,
          reportingPeriod: PERIOD,
          computedByUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(again.version).toBe(2);
    const latest = await withOrgContext(orgA, (db) => latestCarbonGraph(db, orgA), prisma);
    expect(latest?.version).toBe(2);
  });

  it('traces a node back to the root', async () => {
    const trace = await withOrgContext(
      orgA,
      (db) => carbonGraphNodeTrace(db, orgA, steelId),
      prisma,
    );
    expect(trace.path[0]).toBe('org');
    expect(trace.path.at(-1)).toBe(steelId);
    expect(trace.hops).toBe(1);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bSnaps = await withOrgContext(orgB, (db) => db.carbonGraphSnapshot.count(), prisma);
    expect(bSnaps).toBe(0);
    const bEdges = await withOrgContext(orgB, (db) => db.supplyChainEdge.count(), prisma);
    expect(bEdges).toBe(0);

    const edges = await withOrgContext(orgA, (db) => listSupplyChainEdges(db, orgA), prisma);
    for (const e of edges) {
      await withOrgContext(
        orgA,
        (db) =>
          deleteSupplyChainEdge(db, {
            organizationId: orgA,
            id: e.id,
            actorUserId: userA,
            requestId: 'test',
          }),
        prisma,
      );
    }
  });
});
