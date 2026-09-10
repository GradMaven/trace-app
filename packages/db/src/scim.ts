import {
  applyScimGroupPatch,
  applyScimUserPatch,
  generateScimToken,
  resolveScimRoleKeys,
  scimManagedRoleKeys,
  scimTokenMatches,
  SCIM_GROUP_SCHEMA,
  SCIM_USER_SCHEMA,
  type ParsedScimGroup,
  type ParsedScimUser,
  type ScimGroupModel,
  type ScimPatchOperation,
  type ScimUserModel,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { withOrgContext, type PrismaClient, type TenantDb } from './client';
import { writeAuditLog } from './audit';

/**
 * SCIM 2.0 service provider (Phase 13g). TRACE is the SCIM *server*: an IdP
 * pushes user / group lifecycle over a bearer-token REST API.
 *
 * A SCIM `User` is the provisioning projection of a `membership` (backed by a
 * platform `user`); `active` mirrors the membership status (active ⇄ suspended).
 * A SCIM `Group` drives role assignment through `scim_config.group_role_mapping`
 * — the reconciler only ever adds / removes roles in the *managed set*
 * (`defaultRoles` ∪ every mapped role), so manually-assigned roles are left
 * alone.
 *
 * `scim_config` / `scim_user` / `scim_group` are RLS-forced; every CRUD function
 * here takes a `TenantDb` and is called inside `withOrgContext`. Only
 * `authenticateScim` runs pre-context (it resolves the org from the URL slug,
 * then opens `withOrgContext` to read the config and compare the token).
 */

type Ctx = { requestId: string; actorUserId?: string | null };

// ---------------------------------------------------------------------------
// Config (org-scoped, admin)
// ---------------------------------------------------------------------------

export interface ScimConfigInput {
  enabled: boolean;
  defaultRoles: string[];
  groupRoleMapping: Record<string, string[]>;
}

export interface ScimConfigView {
  enabled: boolean;
  hasToken: boolean;
  tokenPrefix: string | null;
  defaultRoles: string[];
  groupRoleMapping: Record<string, string[]>;
  lastRequestAt: string | null;
  userCount: number;
  groupCount: number;
}

interface LoadedScimConfig {
  id: string;
  enabled: boolean;
  defaultRoles: string[];
  groupRoleMapping: Record<string, string[]>;
}

function readGroupRoleMapping(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
  }
  return out;
}

async function requireScimConfig(db: TenantDb, organizationId: string): Promise<LoadedScimConfig> {
  const c = await db.scimConfig.findUnique({ where: { organizationId } });
  if (!c) {
    throw AppError.notFound('scim.not_configured', 'SCIM is not configured for this workspace.');
  }
  return {
    id: c.id,
    enabled: c.enabled,
    defaultRoles: c.defaultRoles,
    groupRoleMapping: readGroupRoleMapping(c.groupRoleMapping),
  };
}

export async function upsertScimConfig(
  db: TenantDb,
  args: { organizationId: string; config: ScimConfigInput; actorUserId: string; requestId: string },
): Promise<void> {
  const c = args.config;
  if (!Array.isArray(c.defaultRoles) || c.defaultRoles.length === 0) {
    throw AppError.unprocessable('scim.no_default_roles', 'At least one default role is required.');
  }
  const mapping = readGroupRoleMapping(c.groupRoleMapping);
  const allMapped = [...c.defaultRoles, ...Object.values(mapping).flat()];
  const known = new Set(
    (
      await db.role.findMany({
        where: { organizationId: args.organizationId },
        select: { key: true },
      })
    ).map((r) => r.key),
  );
  const unknown = allMapped.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw AppError.unprocessable(
      'scim.unknown_role',
      `Role mapping references unknown role(s): ${[...new Set(unknown)].join(', ')}.`,
    );
  }

  const existing = await db.scimConfig.findUnique({
    where: { organizationId: args.organizationId },
  });
  const data = {
    enabled: c.enabled,
    defaultRoles: [...new Set(c.defaultRoles)],
    groupRoleMapping: mapping,
  };
  await db.scimConfig.upsert({
    where: { organizationId: args.organizationId },
    create: { organizationId: args.organizationId, createdByUserId: args.actorUserId, ...data },
    update: data,
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: existing ? 'scim.config_updated' : 'scim.config_created',
    resourceType: 'scim_config',
    resourceId: args.organizationId,
    before: existing ? { enabled: existing.enabled } : null,
    after: { enabled: data.enabled },
    requestId: args.requestId,
  });
}

export async function getScimConfig(
  db: TenantDb,
  organizationId: string,
): Promise<ScimConfigView | null> {
  const c = await db.scimConfig.findUnique({ where: { organizationId } });
  if (!c) return null;
  const [userCount, groupCount] = await Promise.all([
    db.scimUser.count({ where: { organizationId } }),
    db.scimGroup.count({ where: { organizationId } }),
  ]);
  return {
    enabled: c.enabled,
    hasToken: Boolean(c.tokenHash),
    tokenPrefix: c.tokenPrefix,
    defaultRoles: c.defaultRoles,
    groupRoleMapping: readGroupRoleMapping(c.groupRoleMapping),
    lastRequestAt: c.lastRequestAt ? c.lastRequestAt.toISOString() : null,
    userCount,
    groupCount,
  };
}

export async function rotateScimToken(
  db: TenantDb,
  args: { organizationId: string; actorUserId: string; requestId: string },
): Promise<{ token: string }> {
  const c = await db.scimConfig.findUnique({ where: { organizationId: args.organizationId } });
  if (!c) {
    throw AppError.notFound('scim.not_configured', 'Configure SCIM before issuing a token.');
  }
  const gen = generateScimToken();
  await db.scimConfig.update({
    where: { id: c.id },
    data: { tokenHash: gen.hash, tokenPrefix: gen.prefix },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'scim.token_rotated',
    resourceType: 'scim_config',
    resourceId: args.organizationId,
    before: null,
    after: { tokenPrefix: gen.prefix },
    requestId: args.requestId,
  });
  return { token: gen.token };
}

export async function deleteScimConfig(
  db: TenantDb,
  args: { organizationId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const c = await db.scimConfig.findUnique({ where: { organizationId: args.organizationId } });
  if (!c) throw AppError.notFound('scim.not_configured', 'SCIM is not configured.');
  await db.scimGroup.deleteMany({ where: { organizationId: args.organizationId } });
  await db.scimUser.deleteMany({ where: { organizationId: args.organizationId } });
  await db.scimConfig.delete({ where: { id: c.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'scim.config_removed',
    resourceType: 'scim_config',
    resourceId: args.organizationId,
    before: { enabled: c.enabled },
    after: null,
    requestId: args.requestId,
  });
}

/** Resolve + verify a SCIM bearer request. Runs before any org context exists. */
export async function authenticateScim(
  prisma: PrismaClient,
  args: { orgSlug: string; bearerToken: string },
): Promise<{ organizationId: string }> {
  const fail = (): AppError =>
    AppError.unauthenticated('scim.unauthorized', 'Invalid SCIM credentials.');
  const org = await prisma.organization.findUnique({
    where: { slug: args.orgSlug.trim().toLowerCase() },
  });
  if (!org) throw fail();
  const config = await withOrgContext(
    org.id,
    (db) => db.scimConfig.findUnique({ where: { organizationId: org.id } }),
    prisma,
  );
  if (
    !config ||
    !config.enabled ||
    !config.tokenHash ||
    !scimTokenMatches(args.bearerToken, config.tokenHash)
  ) {
    throw fail();
  }
  if (!config.lastRequestAt || Date.now() - config.lastRequestAt.getTime() > 60_000) {
    await withOrgContext(
      org.id,
      (db) => db.scimConfig.update({ where: { id: config.id }, data: { lastRequestAt: new Date() } }),
      prisma,
    ).catch(() => undefined);
  }
  return { organizationId: org.id };
}

// ---------------------------------------------------------------------------
// Role reconciliation
// ---------------------------------------------------------------------------

async function reconcileMemberRoles(
  db: TenantDb,
  organizationId: string,
  scimUserId: string,
  config: LoadedScimConfig,
): Promise<void> {
  const su = await db.scimUser.findFirst({
    where: { id: scimUserId, organizationId },
    include: {
      groupLinks: { include: { group: { select: { displayName: true, externalId: true } } } },
    },
  });
  if (!su) return;
  const membership = await db.membership.findFirst({
    where: { organizationId, userId: su.userId },
    include: { roles: { include: { role: { select: { id: true, key: true } } } } },
  });
  if (!membership) return;

  const managed = new Set(scimManagedRoleKeys(config.defaultRoles, config.groupRoleMapping));
  if (managed.size === 0) return;

  const groupKeys = su.groupLinks.flatMap((l) =>
    [l.group.displayName, l.group.externalId].filter((s): s is string => Boolean(s)),
  );
  const wanted = new Set(
    resolveScimRoleKeys(config.defaultRoles, config.groupRoleMapping, groupKeys),
  );

  const roleRows = await db.role.findMany({
    where: { organizationId, key: { in: [...managed] } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(roleRows.map((r) => [r.key, r.id]));
  const currentByRoleId = new Map(membership.roles.map((mr) => [mr.role.id, mr.role.key]));

  for (const key of wanted) {
    const roleId = idByKey.get(key);
    if (roleId && !currentByRoleId.has(roleId)) {
      await db.membershipRole
        .create({ data: { membershipId: membership.id, roleId } })
        .catch(() => undefined);
    }
  }
  for (const [roleId, key] of currentByRoleId) {
    if (managed.has(key) && !wanted.has(key)) {
      await db.membershipRole
        .delete({ where: { membershipId_roleId: { membershipId: membership.id, roleId } } })
        .catch(() => undefined);
    }
  }
}

async function applyMembershipStatus(
  db: TenantDb,
  organizationId: string,
  userId: string,
  active: boolean,
): Promise<void> {
  const m = await db.membership.findFirst({ where: { organizationId, userId } });
  if (!m) return;
  const want = active ? 'active' : 'suspended';
  if (m.status !== want) {
    await db.membership.update({ where: { id: m.id }, data: { status: want } });
  }
}

// ---------------------------------------------------------------------------
// User resources
// ---------------------------------------------------------------------------

type ScimUserRow = {
  id: string;
  externalId: string | null;
  userName: string;
  active: boolean;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { email: string };
};

function toUserModel(row: ScimUserRow): ScimUserModel {
  return {
    id: row.id,
    externalId: row.externalId,
    userName: row.userName,
    active: row.active,
    givenName: row.givenName,
    familyName: row.familyName,
    displayName: row.displayName,
    primaryEmail: row.user.email,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rawUser(p: ParsedScimUser) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    userName: p.userName,
    active: p.active,
    ...(p.externalId ? { externalId: p.externalId } : {}),
    ...(p.displayName ? { displayName: p.displayName } : {}),
    name: {
      ...(p.givenName ? { givenName: p.givenName } : {}),
      ...(p.familyName ? { familyName: p.familyName } : {}),
    },
    ...(p.primaryEmail ? { emails: [{ value: p.primaryEmail, primary: true }] } : {}),
  };
}

function joinName(given: string | null, family: string | null): string | null {
  const s = [given, family].filter(Boolean).join(' ');
  return s || null;
}

export interface ScimListResult<T> {
  resources: T[];
  totalResults: number;
}

export async function scimListUsers(
  db: TenantDb,
  organizationId: string,
  opts: { filter: { attribute: string; value: string } | null; startIndex: number; count: number },
): Promise<ScimListResult<ScimUserModel>> {
  const where: Record<string, unknown> = { organizationId };
  if (opts.filter) {
    const a = opts.filter.attribute.toLowerCase();
    if (a === 'username') where.userName = opts.filter.value;
    else if (a === 'externalid') where.externalId = opts.filter.value;
    else if (a === 'active') where.active = opts.filter.value.toLowerCase() === 'true';
    else return { resources: [], totalResults: 0 };
  }
  const totalResults = await db.scimUser.count({ where });
  if (opts.count === 0) return { resources: [], totalResults };
  const rows = await db.scimUser.findMany({
    where,
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
    skip: opts.startIndex - 1,
    take: opts.count,
  });
  return { resources: rows.map(toUserModel), totalResults };
}

export async function scimGetUser(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<ScimUserModel | null> {
  const row = await db.scimUser.findFirst({
    where: { id, organizationId },
    include: { user: { select: { email: true } } },
  });
  return row ? toUserModel(row) : null;
}

export async function scimCreateUser(
  db: TenantDb,
  organizationId: string,
  parsed: ParsedScimUser,
  ctx: Ctx,
): Promise<ScimUserModel> {
  const config = await requireScimConfig(db, organizationId);
  if (!parsed.primaryEmail) {
    throw AppError.unprocessable(
      'scim.invalid_value',
      'userName must be an email address, or provide an emails[] entry.',
    );
  }
  const clash = await db.scimUser.findFirst({
    where: { organizationId, userName: parsed.userName },
  });
  if (clash) {
    throw AppError.conflict('scim.uniqueness', 'A user with this userName already exists.');
  }

  const displayName = parsed.displayName ?? joinName(parsed.givenName, parsed.familyName) ?? parsed.userName;
  const user = await db.user.upsert({
    where: { email: parsed.primaryEmail },
    create: {
      email: parsed.primaryEmail,
      name: displayName,
      externalId: parsed.externalId ?? undefined,
    },
    update: parsed.externalId ? { externalId: parsed.externalId } : {},
  });

  const dupUser = await db.scimUser.findFirst({ where: { organizationId, userId: user.id } });
  if (dupUser) {
    throw AppError.conflict(
      'scim.uniqueness',
      'This user is already provisioned under a different userName.',
    );
  }

  const membership = await db.membership.findFirst({
    where: { organizationId, userId: user.id },
  });
  const wantStatus = parsed.active ? 'active' : 'suspended';
  if (!membership) {
    await db.membership.create({ data: { organizationId, userId: user.id, status: wantStatus } });
  } else if (membership.status !== wantStatus) {
    await db.membership.update({ where: { id: membership.id }, data: { status: wantStatus } });
  }

  const su = await db.scimUser.create({
    data: {
      organizationId,
      userId: user.id,
      externalId: parsed.externalId,
      userName: parsed.userName,
      active: parsed.active,
      givenName: parsed.givenName,
      familyName: parsed.familyName,
      displayName: parsed.displayName,
      raw: rawUser(parsed),
    },
  });
  await reconcileMemberRoles(db, organizationId, su.id, config);
  await writeAuditLog(db, {
    organizationId,
    actorId: user.id,
    action: 'scim.user_provisioned',
    resourceType: 'scim_user',
    resourceId: su.id,
    before: null,
    after: { userName: parsed.userName, active: parsed.active },
    requestId: ctx.requestId,
  });
  return toUserModel({ ...su, user: { email: parsed.primaryEmail } });
}

async function persistUser(
  db: TenantDb,
  organizationId: string,
  row: { id: string; userName: string; userId: string },
  next: ScimUserModel,
): Promise<void> {
  if (next.userName !== row.userName) {
    const clash = await db.scimUser.findFirst({
      where: { organizationId, userName: next.userName, NOT: { id: row.id } },
    });
    if (clash) throw AppError.conflict('scim.uniqueness', 'userName is already in use.');
  }
  await db.scimUser.update({
    where: { id: row.id },
    data: {
      userName: next.userName,
      active: next.active,
      externalId: next.externalId,
      givenName: next.givenName,
      familyName: next.familyName,
      displayName: next.displayName,
      raw: {
        schemas: [SCIM_USER_SCHEMA],
        userName: next.userName,
        active: next.active,
        ...(next.externalId ? { externalId: next.externalId } : {}),
        ...(next.displayName ? { displayName: next.displayName } : {}),
        name: {
          ...(next.givenName ? { givenName: next.givenName } : {}),
          ...(next.familyName ? { familyName: next.familyName } : {}),
        },
        ...(next.primaryEmail ? { emails: [{ value: next.primaryEmail, primary: true }] } : {}),
      },
    },
  });
}

export async function scimReplaceUser(
  db: TenantDb,
  organizationId: string,
  id: string,
  parsed: ParsedScimUser,
  ctx: Ctx,
): Promise<ScimUserModel> {
  const config = await requireScimConfig(db, organizationId);
  const row = await db.scimUser.findFirst({
    where: { id, organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!row) throw AppError.notFound('scim.not_found', 'User not found.');

  const next: ScimUserModel = {
    ...toUserModel(row),
    userName: parsed.userName,
    active: parsed.active,
    externalId: parsed.externalId,
    givenName: parsed.givenName,
    familyName: parsed.familyName,
    displayName: parsed.displayName,
  };
  await persistUser(db, organizationId, row, next);
  await applyMembershipStatus(db, organizationId, row.userId, next.active);
  await reconcileMemberRoles(db, organizationId, row.id, config);
  await writeAuditLog(db, {
    organizationId,
    actorId: row.userId,
    action: 'scim.user_updated',
    resourceType: 'scim_user',
    resourceId: row.id,
    before: { active: row.active },
    after: { userName: next.userName, active: next.active },
    requestId: ctx.requestId,
  });
  return { ...next, primaryEmail: row.user.email, updatedAt: new Date().toISOString() };
}

export async function scimPatchUser(
  db: TenantDb,
  organizationId: string,
  id: string,
  operations: ScimPatchOperation[],
  ctx: Ctx,
): Promise<ScimUserModel> {
  const config = await requireScimConfig(db, organizationId);
  const row = await db.scimUser.findFirst({
    where: { id, organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!row) throw AppError.notFound('scim.not_found', 'User not found.');

  const before = toUserModel(row);
  const next = applyScimUserPatch(before, operations);
  await persistUser(db, organizationId, row, next);
  await applyMembershipStatus(db, organizationId, row.userId, next.active);
  await reconcileMemberRoles(db, organizationId, row.id, config);

  const action =
    before.active === next.active
      ? 'scim.user_updated'
      : next.active
        ? 'scim.user_reactivated'
        : 'scim.user_deprovisioned';
  await writeAuditLog(db, {
    organizationId,
    actorId: row.userId,
    action,
    resourceType: 'scim_user',
    resourceId: row.id,
    before: { active: before.active },
    after: { active: next.active },
    requestId: ctx.requestId,
  });
  return { ...next, primaryEmail: row.user.email, updatedAt: new Date().toISOString() };
}

export async function scimDeleteUser(
  db: TenantDb,
  organizationId: string,
  id: string,
  ctx: Ctx,
): Promise<void> {
  const config = await requireScimConfig(db, organizationId);
  const row = await db.scimUser.findFirst({ where: { id, organizationId } });
  if (!row) throw AppError.notFound('scim.not_found', 'User not found.');

  await db.scimGroupMember.deleteMany({ where: { scimUserId: row.id } });
  await db.scimUser.delete({ where: { id: row.id } });

  const membership = await db.membership.findFirst({
    where: { organizationId, userId: row.userId },
  });
  if (membership) {
    if (membership.status === 'active') {
      await db.membership.update({ where: { id: membership.id }, data: { status: 'suspended' } });
    }
    const managed = scimManagedRoleKeys(config.defaultRoles, config.groupRoleMapping);
    if (managed.length > 0) {
      const managedRoleIds = (
        await db.role.findMany({
          where: { organizationId, key: { in: managed } },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (managedRoleIds.length > 0) {
        await db.membershipRole.deleteMany({
          where: { membershipId: membership.id, roleId: { in: managedRoleIds } },
        });
      }
    }
  }
  await writeAuditLog(db, {
    organizationId,
    actorId: row.userId,
    action: 'scim.user_deprovisioned',
    resourceType: 'scim_user',
    resourceId: row.id,
    before: { userName: row.userName },
    after: null,
    requestId: ctx.requestId,
  });
}

// ---------------------------------------------------------------------------
// Group resources
// ---------------------------------------------------------------------------

type ScimGroupRow = {
  id: string;
  externalId: string | null;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
};

function toGroupModel(row: ScimGroupRow): ScimGroupModel {
  return {
    id: row.id,
    externalId: row.externalId,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ScimGroupWithMembers {
  model: ScimGroupModel;
  members: Array<{ id: string; display: string | null }>;
}

async function loadGroupMembers(
  db: TenantDb,
  organizationId: string,
  scimGroupId: string,
): Promise<Array<{ id: string; display: string | null }>> {
  const links = await db.scimGroupMember.findMany({
    where: { scimGroupId, user: { organizationId } },
    include: { user: { select: { id: true, displayName: true, userName: true } } },
  });
  return links.map((l) => ({ id: l.user.id, display: l.user.displayName ?? l.user.userName }));
}

export async function scimListGroups(
  db: TenantDb,
  organizationId: string,
  opts: { filter: { attribute: string; value: string } | null; startIndex: number; count: number },
): Promise<ScimListResult<ScimGroupWithMembers>> {
  const where: Record<string, unknown> = { organizationId };
  if (opts.filter) {
    const a = opts.filter.attribute.toLowerCase();
    if (a === 'displayname') where.displayName = opts.filter.value;
    else if (a === 'externalid') where.externalId = opts.filter.value;
    else return { resources: [], totalResults: 0 };
  }
  const totalResults = await db.scimGroup.count({ where });
  if (opts.count === 0) return { resources: [], totalResults };
  const rows = await db.scimGroup.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    skip: opts.startIndex - 1,
    take: opts.count,
  });
  const resources: ScimGroupWithMembers[] = [];
  for (const row of rows) {
    resources.push({
      model: toGroupModel(row),
      members: await loadGroupMembers(db, organizationId, row.id),
    });
  }
  return { resources, totalResults };
}

export async function scimGetGroup(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<ScimGroupWithMembers | null> {
  const row = await db.scimGroup.findFirst({ where: { id, organizationId } });
  if (!row) return null;
  return { model: toGroupModel(row), members: await loadGroupMembers(db, organizationId, row.id) };
}

async function setGroupMembers(
  db: TenantDb,
  organizationId: string,
  config: LoadedScimConfig,
  scimGroupId: string,
  currentIds: string[],
  desiredIds: string[],
): Promise<void> {
  const valid = new Set(
    (
      await db.scimUser.findMany({
        where: { organizationId, id: { in: desiredIds } },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  const finalIds = desiredIds.filter((i) => valid.has(i));
  const toAdd = finalIds.filter((i) => !currentIds.includes(i));
  const toRemove = currentIds.filter((i) => !finalIds.includes(i));
  for (const scimUserId of toAdd) {
    await db.scimGroupMember
      .create({ data: { scimGroupId, scimUserId } })
      .catch(() => undefined);
  }
  if (toRemove.length > 0) {
    await db.scimGroupMember.deleteMany({
      where: { scimGroupId, scimUserId: { in: toRemove } },
    });
  }
  for (const scimUserId of new Set([...toAdd, ...toRemove])) {
    await reconcileMemberRoles(db, organizationId, scimUserId, config);
  }
}

export async function scimCreateGroup(
  db: TenantDb,
  organizationId: string,
  parsed: ParsedScimGroup,
  ctx: Ctx,
): Promise<ScimGroupWithMembers> {
  const config = await requireScimConfig(db, organizationId);
  const clash = await db.scimGroup.findFirst({
    where: { organizationId, displayName: parsed.displayName },
  });
  if (clash) {
    throw AppError.conflict('scim.uniqueness', 'A group with this displayName already exists.');
  }
  const group = await db.scimGroup.create({
    data: {
      organizationId,
      displayName: parsed.displayName,
      externalId: parsed.externalId,
      raw: { schemas: [SCIM_GROUP_SCHEMA], displayName: parsed.displayName },
    },
  });
  await setGroupMembers(db, organizationId, config, group.id, [], parsed.memberIds);
  await writeAuditLog(db, {
    organizationId,
    actorId: ctx.actorUserId ?? null,
    action: 'scim.group_created',
    resourceType: 'scim_group',
    resourceId: group.id,
    before: null,
    after: { displayName: parsed.displayName, members: parsed.memberIds.length },
    requestId: ctx.requestId,
  });
  return {
    model: toGroupModel(group),
    members: await loadGroupMembers(db, organizationId, group.id),
  };
}

async function renameGuard(
  db: TenantDb,
  organizationId: string,
  groupId: string,
  displayName: string,
  current: string,
): Promise<void> {
  if (displayName === current) return;
  const clash = await db.scimGroup.findFirst({
    where: { organizationId, displayName, NOT: { id: groupId } },
  });
  if (clash) throw AppError.conflict('scim.uniqueness', 'displayName is already in use.');
}

export async function scimReplaceGroup(
  db: TenantDb,
  organizationId: string,
  id: string,
  parsed: ParsedScimGroup,
  ctx: Ctx,
): Promise<ScimGroupWithMembers> {
  const config = await requireScimConfig(db, organizationId);
  const group = await db.scimGroup.findFirst({
    where: { id, organizationId },
    include: { members: { select: { scimUserId: true } } },
  });
  if (!group) throw AppError.notFound('scim.not_found', 'Group not found.');
  await renameGuard(db, organizationId, group.id, parsed.displayName, group.displayName);

  await db.scimGroup.update({
    where: { id: group.id },
    data: { displayName: parsed.displayName, externalId: parsed.externalId },
  });
  await setGroupMembers(
    db,
    organizationId,
    config,
    group.id,
    group.members.map((m) => m.scimUserId),
    parsed.memberIds,
  );
  await writeAuditLog(db, {
    organizationId,
    actorId: ctx.actorUserId ?? null,
    action: 'scim.group_updated',
    resourceType: 'scim_group',
    resourceId: group.id,
    before: { displayName: group.displayName },
    after: { displayName: parsed.displayName },
    requestId: ctx.requestId,
  });
  const fresh = await scimGetGroup(db, organizationId, group.id);
  return fresh!;
}

export async function scimPatchGroup(
  db: TenantDb,
  organizationId: string,
  id: string,
  operations: ScimPatchOperation[],
  ctx: Ctx,
): Promise<ScimGroupWithMembers> {
  const config = await requireScimConfig(db, organizationId);
  const group = await db.scimGroup.findFirst({
    where: { id, organizationId },
    include: { members: { select: { scimUserId: true } } },
  });
  if (!group) throw AppError.notFound('scim.not_found', 'Group not found.');

  const currentIds = group.members.map((m) => m.scimUserId);
  const nextState = applyScimGroupPatch(
    { displayName: group.displayName, externalId: group.externalId, memberIds: currentIds },
    operations,
  );
  await renameGuard(db, organizationId, group.id, nextState.displayName, group.displayName);

  await db.scimGroup.update({
    where: { id: group.id },
    data: { displayName: nextState.displayName, externalId: nextState.externalId },
  });
  await setGroupMembers(db, organizationId, config, group.id, currentIds, nextState.memberIds);
  await writeAuditLog(db, {
    organizationId,
    actorId: ctx.actorUserId ?? null,
    action: 'scim.group_updated',
    resourceType: 'scim_group',
    resourceId: group.id,
    before: { displayName: group.displayName },
    after: { displayName: nextState.displayName },
    requestId: ctx.requestId,
  });
  const fresh = await scimGetGroup(db, organizationId, group.id);
  return fresh!;
}

export async function scimDeleteGroup(
  db: TenantDb,
  organizationId: string,
  id: string,
  ctx: Ctx,
): Promise<void> {
  const config = await requireScimConfig(db, organizationId);
  const group = await db.scimGroup.findFirst({
    where: { id, organizationId },
    include: { members: { select: { scimUserId: true } } },
  });
  if (!group) throw AppError.notFound('scim.not_found', 'Group not found.');
  const affected = group.members.map((m) => m.scimUserId);
  await db.scimGroup.delete({ where: { id: group.id } });
  for (const scimUserId of affected) {
    await reconcileMemberRoles(db, organizationId, scimUserId, config);
  }
  await writeAuditLog(db, {
    organizationId,
    actorId: ctx.actorUserId ?? null,
    action: 'scim.group_deleted',
    resourceType: 'scim_group',
    resourceId: group.id,
    before: { displayName: group.displayName },
    after: null,
    requestId: ctx.requestId,
  });
}

// ---------------------------------------------------------------------------
// Admin overview (console)
// ---------------------------------------------------------------------------

export interface ScimAdminOverview {
  users: Array<{
    id: string;
    userName: string;
    email: string;
    displayName: string | null;
    active: boolean;
    roleKeys: string[];
  }>;
  groups: Array<{
    id: string;
    displayName: string;
    externalId: string | null;
    memberCount: number;
  }>;
}

export async function scimAdminOverview(
  db: TenantDb,
  organizationId: string,
): Promise<ScimAdminOverview> {
  const users = await db.scimUser.findMany({
    where: { organizationId },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const memberships = await db.membership.findMany({
    where: { organizationId, userId: { in: users.map((u) => u.userId) } },
    include: { roles: { include: { role: { select: { key: true } } } } },
  });
  const rolesByUser = new Map(
    memberships.map((m) => [m.userId, m.roles.map((r) => r.role.key)]),
  );
  const groups = await db.scimGroup.findMany({
    where: { organizationId },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return {
    users: users.map((u) => ({
      id: u.id,
      userName: u.userName,
      email: u.user.email,
      displayName: u.displayName,
      active: u.active,
      roleKeys: rolesByUser.get(u.userId) ?? [],
    })),
    groups: groups.map((g) => ({
      id: g.id,
      displayName: g.displayName,
      externalId: g.externalId,
      memberCount: g._count.members,
    })),
  };
}
