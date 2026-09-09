import { describe, expect, it } from 'vitest';
import { isBuiltInRoleKey, validateCustomRole } from './role';

describe('validateCustomRole', () => {
  it('accepts a well-formed custom role and returns cleaned permissions', () => {
    const r = validateCustomRole({
      key: 'data_steward',
      name: 'Data Steward',
      permissions: ['evidence.read', 'activity.read', 'evidence.read', 'trust.read'],
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.permissions).toEqual(['activity.read', 'evidence.read', 'trust.read']);
  });

  it('rejects a bad key, a built-in key, and an empty name', () => {
    expect(
      validateCustomRole({ key: 'Bad Key', name: 'X', permissions: ['evidence.read'] }).ok,
    ).toBe(false);
    const builtin = validateCustomRole({
      key: 'auditor',
      name: 'Auditor 2',
      permissions: ['evidence.read'],
    });
    expect(builtin.ok).toBe(false);
    expect(builtin.errors.join()).toMatch(/built-in/);
  });

  it('rejects unknown permissions and platform.admin', () => {
    const r = validateCustomRole({
      key: 'sneaky',
      name: 'Sneaky',
      permissions: ['platform.admin', 'evidence.destroy', 'evidence.read'],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/platform\.admin/);
    expect(r.errors.join()).toMatch(/Unknown permission/);
  });

  it('rejects a role with no valid permissions', () => {
    expect(validateCustomRole({ key: 'empty_role', name: 'Empty', permissions: [] }).ok).toBe(
      false,
    );
  });
});

describe('isBuiltInRoleKey', () => {
  it('knows the shipped role keys', () => {
    expect(isBuiltInRoleKey('organization_admin')).toBe(true);
    expect(isBuiltInRoleKey('data_steward')).toBe(false);
  });
});
