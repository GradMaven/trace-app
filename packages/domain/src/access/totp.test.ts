import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  otpauthUrl,
  totpCodeAt,
  verifyTotp,
} from './totp';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const buf = Buffer.from(s);
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
  });

  it('matches the RFC 4648 test vector for "foobar"', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B uses an ASCII seed; SHA-1, 8 digits. We use 6 digits and
  // a base32 secret, so assert internal consistency instead of the RFC table.
  const secret = generateTotpSecret();

  it('generates a 6-digit code that verifies at the same instant', () => {
    const at = new Date('2026-06-01T12:00:30Z');
    const code = totpCodeAt(secret, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, { at })).toBe(0);
  });

  it('accepts a code from the previous step (clock drift) within the window', () => {
    const at = new Date('2026-06-01T12:00:30Z');
    const prev = totpCodeAt(secret, new Date(at.getTime() - 30_000));
    expect(verifyTotp(secret, prev, { at })).toBe(-1);
  });

  it('rejects a code two steps away and garbage input', () => {
    const at = new Date('2026-06-01T12:00:30Z');
    const old = totpCodeAt(secret, new Date(at.getTime() - 90_000));
    expect(verifyTotp(secret, old, { at })).toBeNull();
    expect(verifyTotp(secret, '12345', { at })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { at })).toBeNull();
  });

  it('is secret-specific', () => {
    const at = new Date('2026-06-01T12:00:30Z');
    const code = totpCodeAt(secret, at);
    expect(verifyTotp(generateTotpSecret(), code, { at })).toBeNull();
  });

  it('builds an otpauth URI an authenticator app can read', () => {
    const url = otpauthUrl({ secret, accountName: 'anke@nordwerk.example' });
    expect(url.startsWith('otpauth://totp/TRACE:anke%40nordwerk.example?')).toBe(true);
    expect(url).toContain(`secret=${secret}`);
    expect(url).toContain('period=30');
  });
});

describe('recovery codes', () => {
  it('generates ten distinct xxxxx-xxxxx codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });

  it('hashes stably and ignores case / spacing', () => {
    expect(hashRecoveryCode('ABCDE-FGHIJ')).toBe(hashRecoveryCode(' abcde-fghij '));
    expect(normalizeRecoveryCode(' Ab Cd ')).toBe('abcd');
    expect(hashRecoveryCode('abcde-fghij')).not.toBe(hashRecoveryCode('abcde-fghik'));
  });
});
