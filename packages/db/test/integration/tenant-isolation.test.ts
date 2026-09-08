import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrisma,
  provisionOrganization,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

/**
 * Proves ADR-003: a transaction scoped to org A cannot read or write org B's
 * rows, at the database layer (RLS), independent of the repository code.
 *
 * Requires DATABASE_URL_TEST pointing at a database with migrations applied
 * (`pnpm --filter @trace/db migrate:deploy`). Skipped otherwise.
 */
const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

run('tenant isolation (RLS)', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);

    // Clean slate for the ids we use.
    await prisma.$executeRawUnsafe('SET session_replication_role = replica');
    for (const id of [orgA, orgB]) {
      await prisma.auditLog.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
      await prisma.auditHead.deleteMany({ where: { scope: id } }).catch(() => undefined);
      await prisma.organization.deleteMany({ where: { id } }).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } }).catch(() => undefined);
    await prisma.$executeRawUnsafe('SET session_replication_role = origin');

    await prisma.user.createMany({
      data: [
        { id: userA, email: `a-${userA}@test.example`, name: 'A' },
        { id: userB, email: `b-${userB}@test.example`, name: 'B' },
      ],
    });

    await withOrgContext(
      orgA,
      (db) =>
        provisionOrganization(db, {
          organizationId: orgA,
          slug: `a-${orgA.slice(0, 8)}`,
          legalName: 'Org A',
          country: 'DE',
          creatorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
    await withOrgContext(
      orgB,
      (db) =>
        provisionOrganization(db, {
          organizationId: orgB,
          slug: `b-${orgB.slice(0, 8)}`,
          legalName: 'Org B',
          country: 'FR',
          creatorUserId: userB,
          requestId: 'test',
        }),
      prisma,
    );

    await withOrgContext(
      orgA,
      (db) => db.businessUnit.create({ data: { organizationId: orgA, name: 'A-unit' } }),
      prisma,
    );
    await withOrgContext(
      orgB,
      (db) => db.businessUnit.create({ data: { organizationId: orgB, name: 'B-unit' } }),
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('only sees its own business units', async () => {
    const seenByA = await withOrgContext(orgA, (db) => db.businessUnit.findMany(), prisma);
    expect(seenByA.map((u) => u.name)).toEqual(['A-unit']);

    const seenByB = await withOrgContext(orgB, (db) => db.businessUnit.findMany(), prisma);
    expect(seenByB.map((u) => u.name)).toEqual(['B-unit']);
  });

  it('only sees its own memberships', async () => {
    const membershipsA = await withOrgContext(orgA, (db) => db.membership.findMany(), prisma);
    expect(membershipsA).toHaveLength(1);
    expect(membershipsA[0]!.userId).toBe(userA);
  });

  it('cannot write a row belonging to another org (WITH CHECK)', async () => {
    await expect(
      withOrgContext(
        orgA,
        (db) => db.businessUnit.create({ data: { organizationId: orgB, name: 'smuggled' } }),
        prisma,
      ),
    ).rejects.toThrow();

    const stillOne = await withOrgContext(orgB, (db) => db.businessUnit.count(), prisma);
    expect(stillOne).toBe(1);
  });

  it('keeps a verifiable audit chain per org', async () => {
    const chainA = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chainA.intact).toBe(true);
    expect(chainA.count).toBeGreaterThanOrEqual(1);
  });
});
