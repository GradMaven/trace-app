import { type Permission } from '@trace/shared';

/**
 * Pure RBAC resolution.
 *
 * The API's request context calls `resolvePermissions` once per request with the
 * actor's roles in the active organization; guards then call `can` / `canAll`.
 * No I/O here — roles are passed in, already loaded.
 */

export interface RoleGrant {
  key: string;
  permissions: readonly Permission[];
}

export class PermissionSet {
  private readonly set: ReadonlySet<Permission>;

  constructor(permissions: Iterable<Permission>) {
    this.set = new Set(permissions);
  }

  has(permission: Permission): boolean {
    return this.set.has(permission);
  }

  hasAll(permissions: readonly Permission[]): boolean {
    return permissions.every((p) => this.set.has(p));
  }

  hasAny(permissions: readonly Permission[]): boolean {
    return permissions.some((p) => this.set.has(p));
  }

  toArray(): Permission[] {
    return [...this.set].sort();
  }
}

export function resolvePermissions(roles: readonly RoleGrant[]): PermissionSet {
  const merged = new Set<Permission>();
  for (const role of roles) {
    for (const permission of role.permissions) {
      merged.add(permission);
    }
  }
  return new PermissionSet(merged);
}

export function can(set: PermissionSet, permission: Permission): boolean {
  return set.has(permission);
}

export function canAll(set: PermissionSet, permissions: readonly Permission[]): boolean {
  return set.hasAll(permissions);
}
