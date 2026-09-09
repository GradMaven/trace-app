import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';

/**
 * OpenID Connect helpers (Phase 13e) — pure. PKCE, the anti-forgery tokens, the
 * authorization-URL builder, RS256 ID-token verification against a JWKS, and the
 * claim → role mapping. All I/O (discovery, the token exchange, fetching the
 * JWKS) is injected in `@trace/db`; this module never touches the network.
 */

export const OIDC_LOGIN_TTL_SECONDS = 600;
export const OIDC_DEFAULT_SCOPES = 'openid email profile';
const CLOCK_SKEW_SECONDS = 120;

// ---------------------------------------------------------------------------
// PKCE + state / nonce
// ---------------------------------------------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function randomUrlToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

export interface Pkce {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export function generatePkce(): Pkce {
  const verifier = b64url(randomBytes(48)); // 64 chars, within the 43–128 spec range
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

/** Recompute the S256 challenge for a verifier (for tests / defensive checks). */
export function pkceChallengeFor(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

// ---------------------------------------------------------------------------
// Authorization request
// ---------------------------------------------------------------------------

export interface AuthorizationUrlInput {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const u = new URL(input.authorizationEndpoint);
  const params = u.searchParams;
  params.set('response_type', 'code');
  params.set('client_id', input.clientId);
  params.set('redirect_uri', input.redirectUri);
  params.set('scope', input.scope || OIDC_DEFAULT_SCOPES);
  params.set('state', input.state);
  params.set('nonce', input.nonce);
  params.set('code_challenge', input.codeChallenge);
  params.set('code_challenge_method', 'S256');
  return u.toString();
}

// ---------------------------------------------------------------------------
// ID-token verification
// ---------------------------------------------------------------------------

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  [claim: string]: unknown;
}

export interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

export interface Jwks {
  keys: Jwk[];
}

export function parseJwt(token: string): { header: JwtHeader; claims: IdTokenClaims } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as JwtHeader;
    const claims = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as IdTokenClaims;
    return { header, claims };
  } catch {
    return null;
  }
}

export type IdTokenResult = { ok: true; claims: IdTokenClaims } | { ok: false; reason: string };

export interface VerifyIdTokenOptions {
  jwks: Jwks;
  issuer: string;
  audience: string;
  /** The nonce minted for this login; the token's `nonce` must equal it. */
  nonce: string;
  now?: Date;
}

/**
 * Verify an OIDC ID token: RS256 signature against the matching JWK, then
 * `iss` / `aud` / `exp` / `nbf` / `nonce`. Only RS256 is accepted (no `alg:none`,
 * no HS*).
 */
export function verifyIdToken(token: string, opts: VerifyIdTokenOptions): IdTokenResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const parsed = parseJwt(token);
  if (!parsed) return { ok: false, reason: 'malformed token' };
  const { header, claims } = parsed;

  if (header.alg !== 'RS256') return { ok: false, reason: `unsupported alg "${header.alg}"` };

  const jwk = opts.jwks.keys.find(
    (k) => k.kty === 'RSA' && (header.kid ? k.kid === header.kid : true),
  );
  if (!jwk) return { ok: false, reason: 'no matching signing key' };

  let signatureValid = false;
  try {
    const key = createPublicKey({ key: jwk as Record<string, unknown>, format: 'jwk' });
    signatureValid = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2]!, 'base64url'),
    );
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? `key error: ${err.message}` : 'key error' };
  }
  if (!signatureValid) return { ok: false, reason: 'bad signature' };

  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (claims.iss !== opts.issuer) return { ok: false, reason: 'issuer mismatch' };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(opts.audience)) return { ok: false, reason: 'audience mismatch' };
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSec) {
    return { ok: false, reason: 'token expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSec) {
    return { ok: false, reason: 'token not yet valid' };
  }
  if (!claims.sub) return { ok: false, reason: 'missing sub' };
  if (claims.nonce !== opts.nonce) return { ok: false, reason: 'nonce mismatch' };

  return { ok: true, claims };
}

// ---------------------------------------------------------------------------
// Claim → role mapping (JIT provisioning)
// ---------------------------------------------------------------------------

export interface OidcRoleMapping {
  /** Roles every JIT-provisioned member gets. */
  defaultRoles: string[];
  /** `{ "example.com": ["esg_analyst"] }` keyed on the email domain (lowercased). */
  emailDomainRoles?: Record<string, string[]>;
  /** The claim carrying the IdP group list (default `groups`). */
  groupClaim?: string;
  /** `{ "trace-admins": ["organization_admin"] }` keyed on a group value. */
  groupRoles?: Record<string, string[]>;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/** Resolve the set of role keys for a set of claims. De-duplicated, order-stable. */
export function mapClaimsToRoleKeys(
  claims: { email?: string; [k: string]: unknown },
  mapping: OidcRoleMapping,
): string[] {
  const out = new Set<string>(mapping.defaultRoles ?? []);

  if (claims.email && mapping.emailDomainRoles) {
    const roles = mapping.emailDomainRoles[emailDomain(claims.email)];
    for (const r of roles ?? []) out.add(r);
  }

  const groupClaim = mapping.groupClaim ?? 'groups';
  const rawGroups = claims[groupClaim];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.map(String)
    : typeof rawGroups === 'string'
      ? rawGroups.split(/[,\s]+/).filter(Boolean)
      : [];
  if (mapping.groupRoles) {
    for (const g of groups) {
      for (const r of mapping.groupRoles[g] ?? []) out.add(r);
    }
  }

  return [...out];
}

/** Domain-allowlist check for JIT provisioning. Empty list = allow any. */
export function emailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  return allowedDomains.map((d) => d.toLowerCase()).includes(emailDomain(email));
}
