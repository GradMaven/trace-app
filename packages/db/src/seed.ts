/**
 * TRACE demo seed — Phase 1 slice.
 *
 * Creates the demo tenant **NordWerk Manufacturing AG** (Germany, industrial
 * manufacturing) with a permission catalog, default roles, and a handful of
 * members and business units. Later phases extend this seed with suppliers,
 * facilities, materials, products, activity data, calculations, evidence,
 * compliance gaps, and audit findings.
 *
 * Everything created here is explicitly demo data (see the `demo:` flags and
 * the `.example` email domain). Idempotent: re-running skips an existing tenant.
 *
 * Run: `pnpm db:seed`
 */
import {
  disconnectPrisma,
  ensurePermissionCatalog,
  ensurePlatformRole,
  getPrisma,
  provisionOrganization,
  withOrgContext,
  withPlatformContext,
  writeAuditLog,
} from './index';

const DEMO = {
  organizationId: '00000000-0000-4000-8000-0000000000d1',
  slug: 'nordwerk',
  legalName: 'NordWerk Manufacturing AG',
  country: 'DE',
  users: {
    admin: {
      id: '00000000-0000-4000-8000-0000000000a1',
      email: 'anke.roth@nordwerk.example',
      name: 'Anke Roth',
    },
    analyst: {
      id: '00000000-0000-4000-8000-0000000000a2',
      email: 'jonas.pfeiffer@nordwerk.example',
      name: 'Jonas Pfeiffer',
    },
    auditor: {
      id: '00000000-0000-4000-8000-0000000000a3',
      email: 'external.auditor@pruefwerk.example',
      name: 'Dr. Petra Vogel',
    },
  },
} as const;

async function main(): Promise<void> {
  const prisma = getPrisma({ datasourceUrl: process.env.DATABASE_URL });

  const existing = await prisma.organization.findUnique({ where: { slug: DEMO.slug } });
  if (existing) {
    console.warn(`[seed] Organization "${DEMO.slug}" already exists (${existing.id}). Nothing to do.`);
    return;
  }

  // 1. Global catalog + platform role.
  await withPlatformContext(async (db) => {
    await ensurePermissionCatalog(db);
    await ensurePlatformRole(db);
  });
  console.warn('[seed] Permission catalog and platform role ensured.');

  // 2. Users (platform-level identity).
  for (const u of Object.values(DEMO.users)) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { id: u.id, email: u.email, name: u.name },
      update: { name: u.name },
    });
  }
  console.warn('[seed] Demo users created.');

  // 3. Provision the organization (org + roles + creator membership + audit).
  const provisioned = await withOrgContext(DEMO.organizationId, (db) =>
    provisionOrganization(db, {
      organizationId: DEMO.organizationId,
      slug: DEMO.slug,
      legalName: DEMO.legalName,
      country: DEMO.country,
      creatorUserId: DEMO.users.admin.id,
      requestId: 'seed',
    }),
  );
  console.warn(`[seed] Organization provisioned: ${DEMO.legalName} (${DEMO.organizationId}).`);

  // 4. Business units + extra members + a pending invitation.
  await withOrgContext(DEMO.organizationId, async (db) => {
    const hq = await db.businessUnit.create({
      data: { organizationId: DEMO.organizationId, name: 'Group Functions' },
    });
    await db.businessUnit.createMany({
      data: [
        { organizationId: DEMO.organizationId, name: 'Operations — Powertrain', parentId: hq.id },
        { organizationId: DEMO.organizationId, name: 'Operations — Structures', parentId: hq.id },
      ],
    });

    const analystMembership = await db.membership.create({
      data: {
        organizationId: DEMO.organizationId,
        userId: DEMO.users.analyst.id,
        status: 'active',
        roles: { create: [{ roleId: provisioned.roleIdsByKey['esg_analyst']! }] },
      },
    });
    const auditorMembership = await db.membership.create({
      data: {
        organizationId: DEMO.organizationId,
        userId: DEMO.users.auditor.id,
        status: 'active',
        roles: { create: [{ roleId: provisioned.roleIdsByKey['auditor']! }] },
      },
    });

    await db.invitation.create({
      data: {
        organizationId: DEMO.organizationId,
        email: 'procurement.lead@nordwerk.example',
        roleKeys: ['procurement_manager'],
        invitedByUserId: DEMO.users.admin.id,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await writeAuditLog(db, {
      organizationId: DEMO.organizationId,
      actorId: DEMO.users.admin.id,
      action: 'seed.completed',
      resourceType: 'organization',
      resourceId: DEMO.organizationId,
      before: null,
      after: {
        businessUnits: 3,
        memberships: [analystMembership.id, auditorMembership.id].length + 1,
        invitationsPending: 1,
        demo: true,
      },
      requestId: 'seed',
    });
  });

  console.warn('[seed] Business units, members, and a pending invitation created.');
  console.warn('[seed] Done. Sign in as anke.roth@nordwerk.example (magic link printed by the API).');
}

main()
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
