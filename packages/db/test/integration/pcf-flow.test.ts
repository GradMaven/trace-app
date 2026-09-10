import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addBomLine,
  computePcf,
  createProduct,
  createPrisma,
  latestPcf,
  listProducts,
  pcfByVersion,
  productDetail,
  provisionOrganization,
  updateProduct,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('PCF: product carbon footprints', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let factorId = '';
  let productId = '';

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
            slug: `pf-${org.slice(0, 8)}`,
            legalName: 'PcfCo',
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
        const f = await db.emissionFactor.create({
          data: {
            organizationId: orgA,
            source: 'TEST',
            sourceRef: 'mat-2',
            name: 'Test material 2 kg/kg',
            value: 2,
            numeratorUnit: 'kgCO2e',
            denominatorUnit: 'kg',
            activityDimension: 'mass',
            scope: 'scope_3',
            validFrom: new Date('2024-01-01'),
          },
        });
        factorId = f.id;
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates a product with a bill of materials', async () => {
    productId = (
      await withOrgContext(
        orgA,
        (db) =>
          createProduct(db, {
            organizationId: orgA,
            input: {
              name: 'Widget',
              functionalUnit: '1 widget',
              referenceUnit: 'unit',
              allocationMethod: 'none',
              allocationFactor: 1,
            },
            actorUserId: userA,
            requestId: 'test',
          }),
        prisma,
      )
    ).id;

    await withOrgContext(
      orgA,
      async (db) => {
        await addBomLine(db, {
          organizationId: orgA,
          productId,
          input: {
            label: 'Material',
            kind: 'material',
            quantity: 10,
            unit: 'kg',
            source: 'factor',
            emissionFactorId: factorId,
            dataTier: 'primary',
          },
          actorUserId: userA,
          requestId: 'test',
        });
        await addBomLine(db, {
          organizationId: orgA,
          productId,
          input: {
            label: 'Packaging',
            kind: 'packaging',
            quantity: 1,
            unit: 'unit',
            source: 'manual',
            manualKgCo2e: 5,
            dataTier: 'estimated',
          },
          actorUserId: userA,
          requestId: 'test',
        });
      },
      prisma,
    );

    const detail = await withOrgContext(orgA, (db) => productDetail(db, orgA, productId), prisma);
    expect(detail.bomLines).toHaveLength(2);
  });

  it('computes an immutable, reproducible PCF and grades data quality', async () => {
    const v1 = await withOrgContext(
      orgA,
      (db) =>
        computePcf(db, {
          organizationId: orgA,
          productId,
          computedByUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(v1.version).toBe(1);
    expect(Number(v1.subtotalKgCo2e)).toBe(25); // 10kg × 2 + 5
    expect(Number(v1.totalKgCo2e)).toBe(25);
    expect(v1.footprint.primaryDataSharePct).toBe(80);
    expect(v1.dataQualityRating).toBe('A');
    const digest1 = v1.inputsDigest;

    // recompute with no input change → same digest, next version
    const v1b = await withOrgContext(
      orgA,
      (db) => computePcf(db, { organizationId: orgA, productId, computedByUserId: userA, requestId: 'test' }),
      prisma,
    );
    expect(v1b.version).toBe(2);
    expect(v1b.inputsDigest).toBe(digest1);

    // change the allocation → new footprint
    await withOrgContext(
      orgA,
      (db) =>
        updateProduct(db, {
          organizationId: orgA,
          id: productId,
          patch: { allocationMethod: 'mass', allocationFactor: 0.5 },
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    const v3 = await withOrgContext(
      orgA,
      (db) => computePcf(db, { organizationId: orgA, productId, computedByUserId: userA, requestId: 'test' }),
      prisma,
    );
    expect(v3.version).toBe(3);
    expect(Number(v3.totalKgCo2e)).toBe(12.5);
    expect(v3.inputsDigest).not.toBe(digest1);

    const latest = await withOrgContext(orgA, (db) => latestPcf(db, orgA, productId), prisma);
    expect(latest?.version).toBe(3);
    const historical = await withOrgContext(orgA, (db) => pcfByVersion(db, orgA, productId, 1), prisma);
    expect(Number(historical?.totalKgCo2e)).toBe(25);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bProducts = await withOrgContext(orgB, (db) => listProducts(db, orgB), prisma);
    expect(bProducts).toHaveLength(0);
    const bCount = await withOrgContext(orgB, (db) => db.pcfRecord.count(), prisma);
    expect(bCount).toBe(0);
  });

});
