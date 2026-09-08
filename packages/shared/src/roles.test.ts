import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, isPermission } from './permissions';
import { ROLE_DEFINITIONS, ROLE_KEYS } from './roles';

describe('permission catalog', () => {
  it('recognizes known keys and rejects unknown ones', () => {
    expect(isPermission('evidence.verify')).toBe(true);
    expect(isPermission('evidence.destroy')).toBe(false);
  });
});

describe('role definitions', () => {
  it('defines every role key', () => {
    for (const key of ROLE_KEYS) {
      expect(ROLE_DEFINITIONS[key]).toBeDefined();
      expect(ROLE_DEFINITIONS[key].key).toBe(key);
    }
  });

  it('only grants permissions that exist in the catalog', () => {
    for (const key of ROLE_KEYS) {
      for (const perm of ROLE_DEFINITIONS[key].permissions) {
        expect(ALL_PERMISSIONS).toContain(perm);
      }
    }
  });

  it('reserves platform.admin for the platform role only', () => {
    for (const key of ROLE_KEYS) {
      const hasPlatformAdmin = ROLE_DEFINITIONS[key].permissions.includes('platform.admin');
      expect(hasPlatformAdmin).toBe(key === 'platform_admin');
    }
  });

  it('keeps the auditor role read-only', () => {
    const writeish = ROLE_DEFINITIONS.auditor.permissions.filter((p) =>
      /\.(create|update|invite|verify|approve|run|manage|remove|generate)$/.test(p),
    );
    expect(writeish).toEqual([]);
  });
});
