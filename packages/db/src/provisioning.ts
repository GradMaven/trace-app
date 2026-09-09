import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ORG_ROLE_KEYS,
  ORG_CREATOR_ROLE_KEY,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  type RoleKey,
} from '@trace/shared';
import { writeAuditLog } from './audit';
import { type TenantDb } from './client';

/**
 * Shared organization-provisioning logic used by both the seed script and the
 * org-onboarding API service, so the two never drift.
 */

export const PROVISIONING_ROLE_KEYS = DEFAULT_ORG_ROLE_KEYS;

/** Upsert the global permission catalog to match @trace/shared. Idempotent. */
export async function ensurePermissionCatalog(db: TenantDb): Promise<void> {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({
      where: { key },
      create: { key, description },
      update: { description },
    });
  }
}

/** Upsert the platform-wide `platform_admin` role. Idempotent. */
export async function ensurePlatformRole(db: TenantDb): Promise<void> {
  const def = ROLE_DEFINITIONS.platform_admin;
  const existing = await db.role.findFirst({
    where: { organizationId: null, key: def.key },
  });
  const role =
    existing ??
    (await db.role.create({
      data: {
        organizationId: null,
        key: def.key,
        name: def.name,
        description: def.description,
        isPlatform: true,
        isSystem: true,
      },
    }));
  await syncRolePermissions(db, role.id, def.permissions);
}

async function syncRolePermissions(
  db: TenantDb,
  roleId: string,
  permissions: readonly string[],
): Promise<void> {
  await db.rolePermission.deleteMany({ where: { roleId } });
  if (permissions.length === 0) return;
  await db.rolePermission.createMany({
    data: permissions.map((permissionKey) => ({ roleId, permissionKey })),
    skipDuplicates: true,
  });
}

export interface ProvisionOrganizationInput {
  /** Must equal the org id `withOrgContext` was opened with. */
  organizationId: string;
  slug: string;
  legalName: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  baseCurrency?: string;
  creatorUserId: string;
  requestId: string;
}

export interface ProvisionedOrganization {
  organizationId: string;
  membershipId: string;
  roleIdsByKey: Record<string, string>;
}

/**
 * Create an organization, its default roles (wired to the permission catalog),
 * and an active `organization_admin` membership for the creator. Writes an
 * audit-log entry. Expects `db` to be a tenant transaction already scoped to
 * `input.organizationId`.
 */
export async function provisionOrganization(
  db: TenantDb,
  input: ProvisionOrganizationInput,
): Promise<ProvisionedOrganization> {
  await ensurePermissionCatalog(db);

  await db.organization.create({
    data: {
      id: input.organizationId,
      slug: input.slug,
      legalName: input.legalName,
      country: input.country.toUpperCase(),
      baseCurrency: (input.baseCurrency ?? 'EUR').toUpperCase(),
    },
  });

  const roleIdsByKey: Record<string, string> = {};
  for (const key of DEFAULT_ORG_ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[key as RoleKey];
    const role = await db.role.create({
      data: {
        organizationId: input.organizationId,
        key: def.key,
        name: def.name,
        description: def.description,
        isPlatform: false,
        isSystem: true,
      },
    });
    roleIdsByKey[key] = role.id;
    await syncRolePermissions(db, role.id, def.permissions);
  }

  const membership = await db.membership.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      userId: input.creatorUserId,
      status: 'active',
      roles: {
        create: [{ roleId: roleIdsByKey[ORG_CREATOR_ROLE_KEY]! }],
      },
    },
  });

  await writeAuditLog(db, {
    organizationId: input.organizationId,
    actorId: input.creatorUserId,
    action: 'organization.provisioned',
    resourceType: 'organization',
    resourceId: input.organizationId,
    before: null,
    after: { slug: input.slug, legalName: input.legalName, country: input.country },
    requestId: input.requestId,
  });

  return { organizationId: input.organizationId, membershipId: membership.id, roleIdsByKey };
}
