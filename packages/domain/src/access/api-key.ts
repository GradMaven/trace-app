import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API-key format & hashing (Phase 13).
 *
 * A presented key looks like `trk_<keyId>_<secret>`:
 *   - `trk_`      fixed prefix, so a leaked key is greppable in logs / repos.
 *   - `<keyId>`   12 lowercase-base32 chars — stored in the clear as `token_prefix`,
 *                 shown in the UI, and used to look the row up without scanning.
 *   - `<secret>`  32 bytes base64url — never stored; only its SHA-256 is kept.
 *
 * Only the full string is ever shown to the user, exactly once, at creation.
 * The server stores `token_prefix` + `hashed_secret` and compares in constant
 * time.
 */

export const API_KEY_PREFIX = 'trk_';
const KEY_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'; // lowercase base32
const KEY_ID_LENGTH = 12;
const SECRET_BYTES = 32;

export interface GeneratedApiKey {
  /** The full secret string — return to the caller once, then discard. */
  token: string;
  /** Public identifier stored in the clear (`token_prefix`). */
  keyId: string;
  /** `sha256(secret)` hex — the only thing persisted for verification. */
  hashedSecret: string;
  /** Last 4 chars of the secret, for a non-reversible visual hint. */
  last4: string;
}

function randomKeyId(): string {
  const bytes = randomBytes(KEY_ID_LENGTH);
  let out = '';
  for (let i = 0; i < KEY_ID_LENGTH; i += 1) {
    out += KEY_ID_ALPHABET[bytes[i]! % KEY_ID_ALPHABET.length];
  }
  return out;
}

export function hashApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const keyId = randomKeyId();
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return {
    token: `${API_KEY_PREFIX}${keyId}_${secret}`,
    keyId,
    hashedSecret: hashApiKeySecret(secret),
    last4: secret.slice(-4),
  };
}

export interface ParsedApiKey {
  keyId: string;
  secret: string;
}

/** Parse a presented key. Returns null if it is not a well-formed TRACE key. */
export function parseApiKey(raw: string): ParsedApiKey | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(API_KEY_PREFIX)) return null;
  const rest = trimmed.slice(API_KEY_PREFIX.length);
  const sep = rest.indexOf('_');
  if (sep <= 0) return null;
  const keyId = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
  if (keyId.length !== KEY_ID_LENGTH || secret.length < 16) return null;
  if (![...keyId].every((c) => KEY_ID_ALPHABET.includes(c))) return null;
  return { keyId, secret };
}

/** Constant-time comparison of a presented secret against a stored hash. */
export function apiKeySecretMatches(presentedSecret: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKeySecret(presentedSecret), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type ApiKeyState = 'active' | 'expired' | 'revoked';

export function apiKeyState(
  row: {
    revokedAt: Date | null;
    expiresAt: Date | null;
  },
  now: Date = new Date(),
): ApiKeyState {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}
