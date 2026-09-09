import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  apiKeySecretMatches,
  apiKeyState,
  generateApiKey,
  hashApiKeySecret,
  parseApiKey,
} from './api-key';

describe('generateApiKey / parseApiKey', () => {
  it('produces a trk_-prefixed token that round-trips through parseApiKey', () => {
    const k = generateApiKey();
    expect(k.token.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(k.token).toContain(`${k.keyId}_`);
    const parsed = parseApiKey(k.token);
    expect(parsed).not.toBeNull();
    expect(parsed!.keyId).toBe(k.keyId);
    expect(hashApiKeySecret(parsed!.secret)).toBe(k.hashedSecret);
    expect(k.token.endsWith(k.last4)).toBe(true);
  });

  it('generates distinct keyIds and secrets', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.keyId).not.toBe(b.keyId);
    expect(a.hashedSecret).not.toBe(b.hashedSecret);
  });

  it('rejects malformed keys', () => {
    expect(parseApiKey('nope')).toBeNull();
    expect(parseApiKey('trk_short_x')).toBeNull();
    expect(parseApiKey('trk_ABCDEFGHIJKL_secretsecretsecret')).toBeNull(); // uppercase keyId
    expect(parseApiKey(`${API_KEY_PREFIX}abcdefghijkl_`)).toBeNull(); // empty secret
  });
});

describe('apiKeySecretMatches', () => {
  it('matches the right secret and rejects a wrong one in constant time', () => {
    const k = generateApiKey();
    const parsed = parseApiKey(k.token)!;
    expect(apiKeySecretMatches(parsed.secret, k.hashedSecret)).toBe(true);
    expect(apiKeySecretMatches('wrong-secret', k.hashedSecret)).toBe(false);
  });
});

describe('apiKeyState', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('is active with no revocation or a future expiry', () => {
    expect(apiKeyState({ revokedAt: null, expiresAt: null }, now)).toBe('active');
    expect(apiKeyState({ revokedAt: null, expiresAt: new Date('2026-12-01T00:00:00Z') }, now)).toBe(
      'active',
    );
  });
  it('is revoked when revokedAt is set, even before expiry', () => {
    expect(apiKeyState({ revokedAt: now, expiresAt: null }, now)).toBe('revoked');
  });
  it('is expired when expiresAt has passed', () => {
    expect(apiKeyState({ revokedAt: null, expiresAt: new Date('2026-01-01T00:00:00Z') }, now)).toBe(
      'expired',
    );
  });
});
