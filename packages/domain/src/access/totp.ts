import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) + recovery codes for two-factor auth (Phase 13b).
 *
 * Pure: secret generation, base32, the HOTP/TOTP primitives, a drift-tolerant
 * verifier, the `otpauth://` URI for authenticator apps, and recovery-code
 * generation + hashing. No storage — `@trace/db` persists `user_mfa`.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps checked either side of `now` — tolerates ~30s of client clock drift. */
export const TOTP_VERIFY_WINDOW = 1;
export const TOTP_ISSUER = 'TRACE';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh 20-byte (160-bit) secret, base32-encoded — the RFC 4226 recommendation. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secretBase32: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // Big-endian 64-bit counter. Counters never exceed 2^53 here, so the high
  // word is written from a safe-integer division.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export function totpCodeAt(secretBase32: string, at: Date, step = TOTP_STEP_SECONDS): string {
  return hotp(secretBase32, Math.floor(at.getTime() / 1000 / step));
}

/**
 * Verify a presented code against `secret`, checking ±`window` steps for drift.
 * Constant-time per candidate. Returns the matched step offset (0 = current),
 * or null.
 */
export function verifyTotp(
  secretBase32: string,
  presented: string,
  opts: { at?: Date; window?: number; step?: number } = {},
): number | null {
  const at = opts.at ?? new Date();
  const window = opts.window ?? TOTP_VERIFY_WINDOW;
  const step = opts.step ?? TOTP_STEP_SECONDS;
  const code = presented.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const counter = Math.floor(at.getTime() / 1000 / step);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = hotp(secretBase32, counter + offset);
    const a = Buffer.from(candidate);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return offset;
  }
  return null;
}

export function otpauthUrl(input: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? TOTP_ISSUER;
  // Keep the issuer:account colon literal (the de-facto convention), encode the parts.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_GROUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars

function recoveryGroup(len = 5): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1)
    out += RECOVERY_GROUP_ALPHABET[bytes[i]! % RECOVERY_GROUP_ALPHABET.length];
  return out;
}

/** Ten single-use `xxxxx-xxxxx` codes. Returned once; only their hashes persist. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => `${recoveryGroup()}-${recoveryGroup()}`);
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHmac('sha256', 'trace.recovery.v1')
    .update(normalizeRecoveryCode(code))
    .digest('hex');
}
