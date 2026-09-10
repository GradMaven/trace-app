import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * SCIM 2.0 service-provider helpers (Phase 13g) — pure. Token generation, the
 * PatchOp normaliser + a plain-model patch applier, resource / list / error
 * serialisers, the `filter` mini-parser, pagination clamping, and the SCIM
 * group → TRACE role resolution. All persistence + reconciliation lives in
 * `@trace/db/scim.ts`.
 *
 * Scope: RFC 7643 core `User` + `Group`, RFC 7644 CRUD + PATCH (`add` / `remove`
 * / `replace`), `eq` filtering, `startIndex` / `count` pagination. Bulk, sort,
 * ETag, password change, and complex filter grammar are out of scope and
 * advertised as unsupported in the ServiceProviderConfig.
 */

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
export const SCIM_RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';

export const SCIM_CONTENT_TYPE = 'application/scim+json';
export const SCIM_TOKEN_PREFIX = 'scim_';
export const SCIM_DEFAULT_COUNT = 100;
export const SCIM_MAX_COUNT = 200;

// ---------------------------------------------------------------------------
// Bearer token
// ---------------------------------------------------------------------------

export interface GeneratedScimToken {
  /** The full secret — returned to the admin once, then discarded. */
  token: string;
  /** `sha256(token)` hex — the only thing persisted. */
  hash: string;
  /** First 12 chars, stored in the clear for a visual hint. */
  prefix: string;
}

export function hashScimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateScimToken(): GeneratedScimToken {
  const token = `${SCIM_TOKEN_PREFIX}${randomBytes(30).toString('base64url')}`;
  return { token, hash: hashScimToken(token), prefix: token.slice(0, 12) };
}

export function scimTokenMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashScimToken(presented.trim()), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return fallback;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Pull a primary email out of a SCIM `emails` value (array / object / string). */
function extractEmail(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().toLowerCase() || null;
  const list = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  const primary = list.find((e) => isRecord(e) && e.primary === true && typeof e.value === 'string');
  const any = list.find((e) => isRecord(e) && typeof e.value === 'string');
  const chosen = primary ?? any;
  return chosen && isRecord(chosen) ? String(chosen.value).trim().toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// User parse + model
// ---------------------------------------------------------------------------

export interface ScimUserModel {
  id: string;
  externalId: string | null;
  userName: string;
  active: boolean;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
  primaryEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedScimUser {
  userName: string;
  externalId: string | null;
  active: boolean;
  givenName: string | null;
  familyName: string | null;
  displayName: string | null;
  primaryEmail: string | null;
}

export function parseScimUser(body: unknown): ParsedScimUser | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const userName = typeof body.userName === 'string' ? body.userName.trim() : '';
  if (!userName) return { error: 'userName is required' };
  const name = isRecord(body.name) ? body.name : {};
  const email = extractEmail(body.emails) ?? (userName.includes('@') ? userName.toLowerCase() : null);
  return {
    userName,
    externalId: strOrNull(body.externalId),
    active: body.active === undefined ? true : toBool(body.active, true),
    givenName: strOrNull(name.givenName),
    familyName: strOrNull(name.familyName),
    displayName: strOrNull(body.displayName),
    primaryEmail: email,
  };
}

// ---------------------------------------------------------------------------
// Group parse + model
// ---------------------------------------------------------------------------

export interface ParsedScimGroup {
  displayName: string;
  externalId: string | null;
  memberIds: string[];
}

export function parseScimGroup(body: unknown): ParsedScimGroup | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName) return { error: 'displayName is required' };
  const members = Array.isArray(body.members) ? body.members : [];
  const memberIds = members
    .map((m) => (isRecord(m) && typeof m.value === 'string' ? m.value.trim() : ''))
    .filter(Boolean);
  return { displayName, externalId: strOrNull(body.externalId), memberIds: [...new Set(memberIds)] };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export interface ScimPatchOperation {
  op: 'add' | 'remove' | 'replace';
  path?: string;
  value?: unknown;
}

export function normalizeScimPatch(
  body: unknown,
): { operations: ScimPatchOperation[] } | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const raw = (body.Operations ?? body.operations) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'Operations must be a non-empty array' };
  }
  const operations: ScimPatchOperation[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return { error: 'each operation must be an object' };
    const op = String(item.op ?? '').toLowerCase();
    if (op !== 'add' && op !== 'remove' && op !== 'replace') {
      return { error: `unsupported op "${String(item.op)}"` };
    }
    const path = typeof item.path === 'string' && item.path.trim() ? item.path.trim() : undefined;
    if (op === 'remove' && !path) return { error: 'a remove operation requires a path' };
    operations.push({ op: op as ScimPatchOperation['op'], path, value: item.value });
  }
  return { operations };
}

function normPath(path: string): string {
  // strip a leading schema-URI segment (e.g. urn:…:User:name.givenName)
  const noUrn = path.replace(/^urn:[^:]+(?::[^:]+)*:(?=[A-Za-z])/i, '');
  return noUrn.toLowerCase();
}

/**
 * Apply user-targeted PATCH ops to a plain model. Unknown paths are ignored
 * (SCIM services are expected to be lenient). Group membership is handled
 * separately (`applyScimGroupPatch`).
 */
export function applyScimUserPatch(
  model: ScimUserModel,
  operations: ScimPatchOperation[],
): ScimUserModel {
  let next: ScimUserModel = { ...model };
  for (const op of operations) {
    if (!op.path) {
      if (isRecord(op.value)) next = mergeUserAttributes(next, op.value);
      continue;
    }
    const path = normPath(op.path);
    const removing = op.op === 'remove';
    switch (path) {
      case 'active':
        next.active = removing ? false : toBool(op.value, next.active);
        break;
      case 'username':
        if (typeof op.value === 'string' && op.value.trim()) next.userName = op.value.trim();
        break;
      case 'displayname':
        next.displayName = removing ? null : strOrNull(op.value);
        break;
      case 'name.givenname':
        next.givenName = removing ? null : strOrNull(op.value);
        break;
      case 'name.familyname':
        next.familyName = removing ? null : strOrNull(op.value);
        break;
      case 'externalid':
        next.externalId = removing ? null : strOrNull(op.value);
        break;
      case 'emails':
      case 'emails[type eq "work"].value': {
        const email = removing ? null : extractEmail(op.value);
        if (email) next.primaryEmail = email;
        break;
      }
      default:
        break;
    }
  }
  return next;
}

function mergeUserAttributes(
  model: ScimUserModel,
  obj: Record<string, unknown>,
): ScimUserModel {
  const next = { ...model };
  if ('active' in obj) next.active = toBool(obj.active, next.active);
  if (typeof obj.userName === 'string' && obj.userName.trim()) next.userName = obj.userName.trim();
  if ('displayName' in obj) next.displayName = strOrNull(obj.displayName);
  if ('externalId' in obj) next.externalId = strOrNull(obj.externalId);
  if (isRecord(obj.name)) {
    if ('givenName' in obj.name) next.givenName = strOrNull(obj.name.givenName);
    if ('familyName' in obj.name) next.familyName = strOrNull(obj.name.familyName);
  }
  if ('emails' in obj) {
    const email = extractEmail(obj.emails);
    if (email) next.primaryEmail = email;
  }
  return next;
}

export interface ScimGroupPatchState {
  displayName: string;
  externalId: string | null;
  memberIds: string[];
}

/** Apply group-targeted PATCH ops to a plain state object. */
export function applyScimGroupPatch(
  state: ScimGroupPatchState,
  operations: ScimPatchOperation[],
): ScimGroupPatchState {
  const next: ScimGroupPatchState = { ...state, memberIds: [...state.memberIds] };

  const applyMembers = (opKind: ScimPatchOperation['op'], ids: string[]): void => {
    if (opKind === 'remove') {
      next.memberIds = ids.length ? next.memberIds.filter((m) => !ids.includes(m)) : [];
    } else if (opKind === 'replace') {
      next.memberIds = [...ids];
    } else {
      next.memberIds = [...new Set([...next.memberIds, ...ids])];
    }
  };

  for (const op of operations) {
    // `members[value eq "id"]` selector (Azure AD's remove-one form)
    const selector = /^members\[\s*value\s+eq\s+"?([^"\]]+)"?\s*\]$/i.exec(op.path ?? '');
    if (selector) {
      if (op.op !== 'add') next.memberIds = next.memberIds.filter((m) => m !== selector[1]!.trim());
      continue;
    }

    if (!op.path) {
      // no path: value is an object of attributes
      if (!isRecord(op.value)) continue;
      if (typeof op.value.displayName === 'string' && op.value.displayName.trim()) {
        next.displayName = op.value.displayName.trim();
      }
      if ('externalId' in op.value) next.externalId = strOrNull(op.value.externalId);
      if ('members' in op.value) applyMembers(op.op, memberIdsFromValue(op.value.members));
      continue;
    }

    const path = normPath(op.path);
    if (path === 'displayname') {
      if (op.op !== 'remove' && typeof op.value === 'string' && op.value.trim()) {
        next.displayName = op.value.trim();
      }
    } else if (path === 'externalid') {
      next.externalId = op.op === 'remove' ? null : strOrNull(op.value);
    } else if (path === 'members') {
      applyMembers(op.op, memberIdsFromValue(op.value));
    }
  }

  next.memberIds = [...new Set(next.memberIds)];
  return next;
}

function memberIdsFromValue(value: unknown): string[] {
  const list = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  return list
    .map((m) => (isRecord(m) && typeof m.value === 'string' ? m.value.trim() : ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Serialisers
// ---------------------------------------------------------------------------

export function scimUserResource(
  model: ScimUserModel,
  opts: { baseUrl: string },
): Record<string, unknown> {
  const name: Record<string, string> = {};
  if (model.givenName) name.givenName = model.givenName;
  if (model.familyName) name.familyName = model.familyName;
  const formatted = [model.givenName, model.familyName].filter(Boolean).join(' ');
  if (formatted) name.formatted = formatted;

  return {
    schemas: [SCIM_USER_SCHEMA],
    id: model.id,
    ...(model.externalId ? { externalId: model.externalId } : {}),
    userName: model.userName,
    ...(model.displayName ? { displayName: model.displayName } : {}),
    ...(Object.keys(name).length ? { name } : {}),
    ...(model.primaryEmail
      ? { emails: [{ value: model.primaryEmail, primary: true, type: 'work' }] }
      : {}),
    active: model.active,
    meta: {
      resourceType: 'User',
      created: model.createdAt,
      lastModified: model.updatedAt,
      location: `${opts.baseUrl}/Users/${model.id}`,
    },
  };
}

export interface ScimGroupModel {
  id: string;
  externalId: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export function scimGroupResource(
  model: ScimGroupModel,
  members: Array<{ id: string; display: string | null }>,
  opts: { baseUrl: string },
): Record<string, unknown> {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: model.id,
    ...(model.externalId ? { externalId: model.externalId } : {}),
    displayName: model.displayName,
    members: members.map((m) => ({
      value: m.id,
      ...(m.display ? { display: m.display } : {}),
      $ref: `${opts.baseUrl}/Users/${m.id}`,
    })),
    meta: {
      resourceType: 'Group',
      created: model.createdAt,
      lastModified: model.updatedAt,
      location: `${opts.baseUrl}/Groups/${model.id}`,
    },
  };
}

export function scimListResponse(
  resources: Array<Record<string, unknown>>,
  opts: { totalResults: number; startIndex: number },
): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: opts.totalResults,
    startIndex: opts.startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function scimError(
  status: number,
  detail: string,
  scimType?: string,
): Record<string, unknown> {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

// ---------------------------------------------------------------------------
// filter + pagination
// ---------------------------------------------------------------------------

export interface ScimFilter {
  attribute: string;
  operator: 'eq';
  value: string;
}

/** Minimal `attribute eq "value"` parser. Anything richer returns null. */
export function parseScimFilter(filter: string | undefined | null): ScimFilter | null {
  if (!filter || typeof filter !== 'string') return null;
  const m = /^\s*([A-Za-z][\w.$-]*)\s+eq\s+"?([^"]*)"?\s*$/i.exec(filter);
  if (!m) return null;
  return { attribute: m[1]!, operator: 'eq', value: m[2]! };
}

export function scimPaginationParams(query: {
  startIndex?: unknown;
  count?: unknown;
}): { startIndex: number; count: number } {
  const rawStart = Number.parseInt(String(query.startIndex ?? ''), 10);
  const rawCount = Number.parseInt(String(query.count ?? ''), 10);
  const startIndex = Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 1;
  const count = Number.isFinite(rawCount)
    ? Math.max(0, Math.min(rawCount, SCIM_MAX_COUNT))
    : SCIM_DEFAULT_COUNT;
  return { startIndex, count };
}

// ---------------------------------------------------------------------------
// SCIM group → TRACE role resolution
// ---------------------------------------------------------------------------

/** Roles a SCIM-provisioned member should hold given their group membership. */
export function resolveScimRoleKeys(
  defaultRoles: string[],
  groupRoleMapping: Record<string, string[]>,
  groupKeys: string[],
): string[] {
  const out = new Set<string>(defaultRoles ?? []);
  for (const key of groupKeys) {
    for (const role of groupRoleMapping[key] ?? []) out.add(role);
  }
  return [...out];
}

/** Every role key SCIM manages — the reconciler only ever adds/removes these. */
export function scimManagedRoleKeys(
  defaultRoles: string[],
  groupRoleMapping: Record<string, string[]>,
): string[] {
  const out = new Set<string>(defaultRoles ?? []);
  for (const roles of Object.values(groupRoleMapping ?? {})) {
    for (const role of roles) out.add(role);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Discovery documents
// ---------------------------------------------------------------------------

export function scimServiceProviderConfig(opts: { baseUrl: string }): Record<string, unknown> {
  return {
    schemas: [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA],
    documentationUri: `${opts.baseUrl}/ServiceProviderConfig`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: SCIM_MAX_COUNT },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication via a long-lived bearer token issued in the TRACE console.',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig', location: `${opts.baseUrl}/ServiceProviderConfig` },
  };
}

export function scimResourceTypes(opts: { baseUrl: string }): Record<string, unknown>[] {
  return [
    {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      schema: SCIM_USER_SCHEMA,
      meta: { resourceType: 'ResourceType', location: `${opts.baseUrl}/ResourceTypes/User` },
    },
    {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      schema: SCIM_GROUP_SCHEMA,
      meta: { resourceType: 'ResourceType', location: `${opts.baseUrl}/ResourceTypes/Group` },
    },
  ];
}

export function scimSchemas(): Record<string, unknown>[] {
  return [
    {
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description: 'SCIM core User',
      attributes: [
        { name: 'userName', type: 'string', required: true, uniqueness: 'server' },
        { name: 'active', type: 'boolean', required: false },
        { name: 'displayName', type: 'string', required: false },
        { name: 'externalId', type: 'string', required: false },
        { name: 'emails', type: 'complex', multiValued: true, required: false },
        { name: 'name', type: 'complex', required: false },
      ],
    },
    {
      id: SCIM_GROUP_SCHEMA,
      name: 'Group',
      description: 'SCIM core Group',
      attributes: [
        { name: 'displayName', type: 'string', required: true },
        { name: 'externalId', type: 'string', required: false },
        { name: 'members', type: 'complex', multiValued: true, required: false },
      ],
    },
  ];
}
