import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUESTIONNAIRE_VERSION } from '@trace/domain';
import {
  createPrisma,
  provisionOrganization,
  recomputeSupplierPassport,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

/**
 * End-to-end at the DB layer: supplier -> submitted questionnaire ->
 * Supplier Passport, plus RLS scoping of the new supplier tables.
 * Requires DATABASE_URL_TEST (CI). Skipped otherwise.
 */
const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('supplier flow + passport', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  let supplierId = '';

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `sa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `sb-${userB}@test.example`, name: 'B' },
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
            slug: `s-${org.slice(0, 8)}`,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }

    supplierId = await withOrgContext(
      orgA,
      async (db) => {
        const s = await db.supplier.create({
          data: {
            organizationId: orgA,
            name: 'XYZ GmbH',
            country: 'DE',
            industryNace: '24.10',
            createdByUserId: userA,
            relationship: {
              create: { organizationId: orgA, category: 'Steel', tier: 1, annualSpend: 18_400_000, currency: 'EUR' },
            },
          },
        });
        await db.supplierRequest.create({
          data: {
            organizationId: orgA,
            supplierId: s.id,
            kind: 'sustainability_questionnaire',
            templateVersion: QUESTIONNAIRE_VERSION,
            title: 'Q',
            status: 'submitted',
            submittedAt: new Date(),
            responses: {
              reporting_period: 'FY2025',
              primary_activity: 'Steel',
              ghg_inventory_exists: true,
              scope1_tco2e: 1283,
              reduction_target: true,
              iso14001: true,
              human_rights_policy: true,
              code_of_conduct: true,
              anti_corruption_policy: true,
              sustainability_contact: 'a@b.example',
            },
          },
        });
        return s.id;
      },
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('builds a passport from the submitted questionnaire', async () => {
    const passport = await withOrgContext(
      orgA,
      (db) =>
        recomputeSupplierPassport(db, {
          organizationId: orgA,
          supplierId,
          computedByUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(passport.version).toBe(1);
    expect(passport.completeness).toBeGreaterThan(0);
    const data = passport.data as { carbon: { scope1: { value: unknown; provenance: string } } };
    expect(data.carbon.scope1).toEqual({ value: 1283, provenance: 'supplier_reported', unit: 'tCO2e' });
  });

  it('bumps the passport version on recompute', async () => {
    const p2 = await withOrgContext(
      orgA,
      (db) =>
        recomputeSupplierPassport(db, {
          organizationId: orgA,
          supplierId,
          computedByUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    expect(p2.version).toBe(2);
  });

  it('does not leak suppliers across tenants (RLS)', async () => {
    const seenByB = await withOrgContext(orgB, (db) => db.supplier.findMany(), prisma);
    expect(seenByB).toHaveLength(0);
  });

  it('rejects creating a supplier for another org (WITH CHECK)', async () => {
    await expect(
      withOrgContext(
        orgA,
        (db) =>
          db.supplier.create({
            data: { organizationId: orgB, name: 'smuggled', country: 'FR', createdByUserId: userA },
          }),
        prisma,
      ),
    ).rejects.toThrow();
  });
});
