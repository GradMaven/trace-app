import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authenticateScim,
  createPrisma,
  deleteScimConfig,
  provisionOrganization,
  rotateScimToken,
  scimAdminOverview,
  scimCreateGroup,
  scimCreateUser,
  scimDeleteUser,
  scimListUsers,
  scimPatchGroup,
  scimPatchUser,
  upsertScimConfig,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

const CTX = { requestId: 'test' };

run('SCIM 2.0: provisioning + role mapping', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const slugA = `sc-${orgA.slice(0, 8)}`;

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `sca-${userA}@test.example`, name: 'A' },
        { id: userB, email: `scb-${userB}@test.example`, name: 'B' },
      ],
    });
    for (const [org, user, slug] of [
      [orgA, userA, slugA],
      [orgB, userB, `sd-${orgB.slice(0, 8)}`],
    ] as const) {
      await withOrgContext(
        org,
        (db) =>
          provisionOrganization(db, {
            organizationId: org,
            slug,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }
    await withOrgContext(
      orgA,
      (db) =>
        upsertScimConfig(db, {
          organizationId: orgA,
          config: {
            enabled: true,
            defaultRoles: ['esg_analyst'],
            groupRoleMapping: { 'TRACE Admins': ['organization_admin'] },
          },
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('issues a token and authenticates only the right bearer', async () => {
    const { token } = await withOrgContext(
      orgA,
      (db) => rotateScimToken(db, { organizationId: orgA, actorUserId: userA, requestId: 'test' }),
      prisma,
    );
    expect(token.startsWith('scim_')).toBe(true);
    const auth = await authenticateScim(prisma, { orgSlug: slugA, bearerToken: token });
    expect(auth.organizationId).toBe(orgA);
    await expect(
      authenticateScim(prisma, { orgSlug: slugA, bearerToken: 'scim_wrong' }),
    ).rejects.toThrow(/invalid/i);
  });

  it('provisions a user with the default role, then a group grants an extra role', async () => {
    const created = await withOrgContext(
      orgA,
      (db) =>
        scimCreateUser(
          db,
          orgA,
          {
            userName: 'ada@acme.test',
            externalId: 'idp-ada',
            active: true,
            givenName: 'Ada',
            familyName: 'Lovelace',
            displayName: 'Ada Lovelace',
            primaryEmail: 'ada@acme.test',
          },
          CTX,
        ),
      prisma,
    );
    expect(created.userName).toBe('ada@acme.test');

    const platformUser = await prisma.user.findUnique({ where: { email: 'ada@acme.test' } });
    const membershipBefore = await withOrgContext(
      orgA,
      (db) =>
        db.membership.findFirst({
          where: { organizationId: orgA, userId: platformUser!.id },
          include: { roles: { include: { role: { select: { key: true } } } } },
        }),
      prisma,
    );
    expect(membershipBefore?.status).toBe('active');
    expect(membershipBefore!.roles.map((r) => r.role.key)).toEqual(['esg_analyst']);

    await withOrgContext(
      orgA,
      (db) =>
        scimCreateGroup(
          db,
          orgA,
          { displayName: 'TRACE Admins', externalId: 'grp-admins', memberIds: [created.id] },
          CTX,
        ),
      prisma,
    );
    const membershipAfter = await withOrgContext(
      orgA,
      (db) =>
        db.membership.findFirst({
          where: { organizationId: orgA, userId: platformUser!.id },
          include: { roles: { include: { role: { select: { key: true } } } } },
        }),
      prisma,
    );
    expect(new Set(membershipAfter!.roles.map((r) => r.role.key))).toEqual(
      new Set(['esg_analyst', 'organization_admin']),
    );

    // Removing the user from the group drops the mapped role but keeps the default.
    const groupId = (
      await withOrgContext(
        orgA,
        (db) => db.scimGroup.findFirst({ where: { organizationId: orgA } }),
        prisma,
      )
    )!.id;
    await withOrgContext(
      orgA,
      (db) =>
        scimPatchGroup(
          db,
          orgA,
          groupId,
          [{ op: 'remove', path: `members[value eq "${created.id}"]` }],
          CTX,
        ),
      prisma,
    );
    const membershipReverted = await withOrgContext(
      orgA,
      (db) =>
        db.membership.findFirst({
          where: { organizationId: orgA, userId: platformUser!.id },
          include: { roles: { include: { role: { select: { key: true } } } } },
        }),
      prisma,
    );
    expect(membershipReverted!.roles.map((r) => r.role.key)).toEqual(['esg_analyst']);
  });

  it('deactivation via PATCH suspends the membership; filter + list work', async () => {
    const su = (
      await withOrgContext(
        orgA,
        (db) =>
          scimListUsers(db, orgA, {
            filter: { attribute: 'userName', value: 'ada@acme.test' },
            startIndex: 1,
            count: 10,
          }),
        prisma,
      )
    ).resources[0]!;
    expect(su.userName).toBe('ada@acme.test');

    await withOrgContext(
      orgA,
      (db) =>
        scimPatchUser(db, orgA, su.id, [{ op: 'replace', path: 'active', value: false }], CTX),
      prisma,
    );
    const platformUser = await prisma.user.findUnique({ where: { email: 'ada@acme.test' } });
    const m = await withOrgContext(
      orgA,
      (db) => db.membership.findFirst({ where: { organizationId: orgA, userId: platformUser!.id } }),
      prisma,
    );
    expect(m?.status).toBe('suspended');

    const overview = await withOrgContext(orgA, (db) => scimAdminOverview(db, orgA), prisma);
    expect(overview.users.find((u) => u.userName === 'ada@acme.test')?.active).toBe(false);
  });

  it('DELETE removes the SCIM user and strips managed roles', async () => {
    const su = (
      await withOrgContext(
        orgA,
        (db) => scimListUsers(db, orgA, { filter: null, startIndex: 1, count: 10 }),
        prisma,
      )
    ).resources[0]!;
    await withOrgContext(orgA, (db) => scimDeleteUser(db, orgA, su.id, CTX), prisma);
    const gone = await withOrgContext(
      orgA,
      (db) => db.scimUser.findFirst({ where: { id: su.id } }),
      prisma,
    );
    expect(gone).toBeNull();
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bCount = await withOrgContext(orgB, (db) => db.scimConfig.count(), prisma);
    expect(bCount).toBe(0);
    const bUsers = await withOrgContext(orgB, (db) => db.scimUser.count(), prisma);
    expect(bUsers).toBe(0);

    await withOrgContext(
      orgA,
      (db) => deleteScimConfig(db, { organizationId: orgA, actorUserId: userA, requestId: 'test' }),
      prisma,
    );
  });
});
