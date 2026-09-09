import { describe, expect, it } from 'vitest';
import { API_KEY_FORBIDDEN_PERMISSIONS, expandApiKeyScopes, normalizeApiKeyScopes } from './scopes';

describe('expandApiKeyScopes', () => {
  it('expands read:all to only .read-style permissions', () => {
    const perms = expandApiKeyScopes(['read:all']);
    expect(perms).toContain('activity.read');
    expect(perms).toContain('compliance.read');
    expect(perms).toContain('ai.read');
    expect(perms.every((p) => /\.read$/.test(p) || p === 'ai.read' || p === 'auditlog.read')).toBe(
      true,
    );
  });

  it('unions multiple scopes and de-duplicates', () => {
    const perms = expandApiKeyScopes(['activity:write', 'integrations:write']);
    expect(perms).toContain('activity.read');
    expect(perms).toContain('activity.create');
    expect(perms).toContain('integration.manage');
    expect(new Set(perms).size).toBe(perms.length);
    expect([...perms]).toEqual([...perms].sort());
  });

  it('never yields a forbidden (self-propagating / admin) permission', () => {
    const perms = expandApiKeyScopes([
      'read:all',
      'audit:write',
      'compliance:write',
      'activity:write',
    ]);
    for (const forbidden of API_KEY_FORBIDDEN_PERMISSIONS) {
      expect(perms).not.toContain(forbidden);
    }
  });

  it('drops unknown scope tokens', () => {
    expect(expandApiKeyScopes(['nonsense', 'also:bad'])).toEqual([]);
  });
});

describe('normalizeApiKeyScopes', () => {
  it('separates accepted from rejected and de-dupes', () => {
    const r = normalizeApiKeyScopes(['read:all', 'read:all', 'bogus']);
    expect(r.scopes).toEqual(['read:all']);
    expect(r.rejected).toEqual(['bogus']);
  });
});
