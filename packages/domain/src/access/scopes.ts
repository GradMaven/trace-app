import { ALL_PERMISSIONS, type Permission } from '@trace/shared';

/**
 * API-key scopes (Phase 13).
 *
 * A key is created with a set of *scope tokens*, not raw permission keys — the
 * tokens are coarse, stable, and safe to print in docs. `expandApiKeyScopes`
 * turns a key's scope list into the concrete permission set the request runs
 * with. Two hard rules, enforced here so no caller can bypass them:
 *
 *  1. A key can never hold an *administrative* permission — minting more keys,
 *     managing webhooks or roles, changing membership, or platform admin. A
 *     leaked key must never be able to escalate or persist itself.
 *  2. The effective set is always a subset of {@link ALL_PERMISSIONS}; unknown
 *     tokens expand to nothing.
 */

export const API_KEY_SCOPES = {
  'read:all': 'Read-only access to every resource in the workspace',
  'evidence:write': 'Create and update evidence and its lifecycle state',
  'activity:write': 'Create and update activity data and run calculations',
  'integrations:write': 'Configure integrations and run activity-data imports',
  'trust:write': 'Run Trust Score computation and data-quality scans',
  'compliance:write': 'Confirm mappings and manage disclosure status',
  'audit:write': 'Manage audits, findings, and packages',
  'ask:use': 'Ask TRACE natural-language questions',
} as const;

export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

export const API_KEY_SCOPE_TOKENS = Object.keys(API_KEY_SCOPES) as ApiKeyScope[];

/**
 * Permissions a key may never hold regardless of scope. These are the
 * self-propagating / access-control / cross-tenant permissions.
 */
export const API_KEY_FORBIDDEN_PERMISSIONS: readonly Permission[] = [
  'apikey.manage',
  'webhook.manage',
  'role.manage',
  'member.invite',
  'member.remove',
  'organization.update',
  'platform.admin',
] as const;

const READ_ALL: readonly Permission[] = ALL_PERMISSIONS.filter((p) => /\.read$/.test(p));

const SCOPE_PERMISSIONS: Record<ApiKeyScope, readonly Permission[]> = {
  'read:all': [...READ_ALL, 'ai.read', 'auditlog.read'],
  'evidence:write': ['evidence.read', 'evidence.create', 'evidence.update', 'evidence.verify'],
  'activity:write': [
    'activity.read',
    'activity.create',
    'activity.update',
    'calculation.read',
    'calculation.run',
    'calculation.approve',
    'emission_factor.manage',
  ],
  'integrations:write': ['activity.read', 'integration.manage'],
  'trust:write': ['trust.read', 'trust.run', 'quality.manage'],
  'compliance:write': ['compliance.read', 'compliance.manage'],
  'audit:write': ['audit.read', 'audit.manage', 'report.generate'],
  'ask:use': ['ask.use'],
};

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return value in API_KEY_SCOPES;
}

/**
 * Expand a key's scope tokens into the concrete, de-duplicated, sorted
 * permission set it authenticates with. Unknown tokens and forbidden
 * permissions are dropped.
 */
export function expandApiKeyScopes(scopes: readonly string[]): Permission[] {
  const forbidden = new Set<Permission>(API_KEY_FORBIDDEN_PERMISSIONS);
  const known = new Set<Permission>(ALL_PERMISSIONS);
  const out = new Set<Permission>();
  for (const scope of scopes) {
    if (!isApiKeyScope(scope)) continue;
    for (const permission of SCOPE_PERMISSIONS[scope]) {
      if (known.has(permission) && !forbidden.has(permission)) out.add(permission);
    }
  }
  return [...out].sort();
}

/** Validate a requested scope list. Returns the accepted subset + any rejects. */
export function normalizeApiKeyScopes(scopes: readonly string[]): {
  scopes: ApiKeyScope[];
  rejected: string[];
} {
  const accepted: ApiKeyScope[] = [];
  const rejected: string[] = [];
  for (const s of scopes) {
    if (isApiKeyScope(s)) {
      if (!accepted.includes(s)) accepted.push(s);
    } else {
      rejected.push(s);
    }
  }
  return { scopes: accepted, rejected };
}
