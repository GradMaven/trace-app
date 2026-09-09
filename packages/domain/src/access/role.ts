import { ALL_PERMISSIONS, ROLE_KEYS, type Permission } from '@trace/shared';

/**
 * Custom-role validation (Phase 13 — "advanced RBAC").
 *
 * `role.manage` holders can define organization-specific roles on top of the
 * eight the product ships with. A custom role is just a `(key, name,
 * permissions)` tuple stored per organization; these rules keep it sane:
 *
 *  - the key is a stable slug, distinct from every built-in role key;
 *  - every permission exists in the catalog;
 *  - `platform.admin` can never be granted by a tenant.
 */

export const CUSTOM_ROLE_KEY_RE = /^[a-z][a-z0-9_]{2,39}$/;
const RESERVED_ROLE_KEYS = new Set<string>(ROLE_KEYS);

export interface CustomRoleInput {
  key: string;
  name: string;
  description?: string;
  permissions: readonly string[];
}

export interface CustomRoleValidation {
  ok: boolean;
  errors: string[];
  /** The cleaned permission list (known, de-duplicated, sorted) when `ok`. */
  permissions: Permission[];
}

export function validateCustomRole(input: CustomRoleInput): CustomRoleValidation {
  const errors: string[] = [];
  const key = input.key.trim();
  const name = input.name.trim();

  if (!CUSTOM_ROLE_KEY_RE.test(key)) {
    errors.push(
      'Key must be lowercase, start with a letter, and use only letters, digits and underscores (3–40 chars).',
    );
  }
  if (RESERVED_ROLE_KEYS.has(key)) {
    errors.push(`"${key}" is a built-in role key and cannot be reused.`);
  }
  if (name.length < 2 || name.length > 80) {
    errors.push('Name must be 2–80 characters.');
  }

  const known = new Set<Permission>(ALL_PERMISSIONS);
  const cleaned = new Set<Permission>();
  const unknown: string[] = [];
  for (const p of input.permissions) {
    if (p === 'platform.admin') {
      errors.push('platform.admin cannot be granted to an organization role.');
      continue;
    }
    if (known.has(p as Permission)) cleaned.add(p as Permission);
    else unknown.push(p);
  }
  if (unknown.length > 0) {
    errors.push(`Unknown permission(s): ${unknown.join(', ')}.`);
  }
  if (cleaned.size === 0) {
    errors.push('A role must grant at least one permission.');
  }

  return { ok: errors.length === 0, errors, permissions: [...cleaned].sort() };
}

export function isBuiltInRoleKey(key: string): boolean {
  return RESERVED_ROLE_KEYS.has(key);
}
