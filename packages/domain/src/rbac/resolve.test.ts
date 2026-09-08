import { describe, expect, it } from 'vitest';
import { canAll, resolvePermissions } from './resolve';

describe('resolvePermissions', () => {
  it('merges permissions across roles and de-duplicates', () => {
    const set = resolvePermissions([
      { key: 'a', permissions: ['evidence.read', 'evidence.create'] },
      { key: 'b', permissions: ['evidence.create', 'calculation.approve'] },
    ]);
    expect(set.toArray()).toEqual([
      'calculation.approve',
      'evidence.create',
      'evidence.read',
    ]);
  });

  it('returns an empty set for no roles', () => {
    const set = resolvePermissions([]);
    expect(set.toArray()).toEqual([]);
    expect(set.has('audit.read')).toBe(false);
  });

  it('checks hasAll / hasAny / canAll correctly', () => {
    const set = resolvePermissions([
      { key: 'r', permissions: ['supplier.read', 'supplier.invite'] },
    ]);
    expect(set.hasAll(['supplier.read', 'supplier.invite'])).toBe(true);
    expect(set.hasAll(['supplier.read', 'audit.read'])).toBe(false);
    expect(set.hasAny(['audit.read', 'supplier.read'])).toBe(true);
    expect(canAll(set, ['supplier.read'])).toBe(true);
  });
});
