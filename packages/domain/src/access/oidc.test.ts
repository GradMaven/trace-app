import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationUrl,
  emailDomainAllowed,
  generatePkce,
  mapClaimsToRoleKeys,
  parseJwt,
  pkceChallengeFor,
  randomUrlToken,
  verifyIdToken,
  type Jwks,
} from './oidc';

// --- a throwaway RSA keypair + a JWT signer, for the verification tests -------

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkPublic = publicKey.export({ format: 'jwk' }) as Record<string, string>;
const JWKS: Jwks = {
  keys: [{ ...jwkPublic, kty: 'RSA', kid: 'test-key', alg: 'RS256', use: 'sig' }],
};

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function signJwt(claims: Record<string, unknown>): string {
  const header = b64url({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = b64url(claims);
  const sig = createSign('RSA-SHA256')
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString('base64url');
  return `${header}.${payload}.${sig}`;
}

const ISSUER = 'https://idp.example.com';
const AUD = 'trace-client-123';
const NONCE = 'nonce-abc';
const nowSec = Math.floor(Date.now() / 1000);
const baseClaims = {
  iss: ISSUER,
  sub: 'idp|user-1',
  aud: AUD,
  exp: nowSec + 300,
  iat: nowSec,
  nonce: NONCE,
  email: 'ada@nordwerk.example',
};

describe('PKCE', () => {
  it('challenge is the base64url sha256 of the verifier', () => {
    const p = generatePkce();
    expect(p.method).toBe('S256');
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.challenge).toBe(pkceChallengeFor(p.verifier));
    expect(p.challenge).not.toMatch(/[+/=]/); // base64url, not base64
  });

  it('randomUrlToken is unguessable and url-safe', () => {
    const a = randomUrlToken();
    const b = randomUrlToken();
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/[+/=]/);
  });
});

describe('buildAuthorizationUrl', () => {
  it('sets the OIDC + PKCE query params', () => {
    const url = new URL(
      buildAuthorizationUrl({
        authorizationEndpoint: 'https://idp.example.com/authorize',
        clientId: AUD,
        redirectUri: 'https://app.example.com/cb',
        state: 'st',
        nonce: NONCE,
        codeChallenge: 'chal',
      }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(AUD);
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
});

describe('verifyIdToken', () => {
  const opts = {
    jwks: JWKS,
    issuer: ISSUER,
    audience: AUD,
    nonce: NONCE,
    now: new Date(nowSec * 1000),
  };

  it('accepts a well-formed, correctly-signed token', () => {
    const r = verifyIdToken(signJwt(baseClaims), opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims.sub).toBe('idp|user-1');
  });

  it('rejects a tampered payload', () => {
    const good = signJwt(baseClaims);
    const [h, , s] = good.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...baseClaims, email: 'evil@x' })).toString('base64url')}.${s}`;
    expect(verifyIdToken(forged, opts)).toMatchObject({ ok: false, reason: 'bad signature' });
  });

  it('rejects wrong audience, wrong issuer, wrong nonce, and expiry', () => {
    expect(verifyIdToken(signJwt({ ...baseClaims, aud: 'other' }), opts)).toMatchObject({
      ok: false,
      reason: 'audience mismatch',
    });
    expect(verifyIdToken(signJwt({ ...baseClaims, iss: 'https://evil' }), opts)).toMatchObject({
      ok: false,
      reason: 'issuer mismatch',
    });
    expect(verifyIdToken(signJwt({ ...baseClaims, nonce: 'nope' }), opts)).toMatchObject({
      ok: false,
      reason: 'nonce mismatch',
    });
    expect(verifyIdToken(signJwt({ ...baseClaims, exp: nowSec - 3600 }), opts)).toMatchObject({
      ok: false,
      reason: 'token expired',
    });
  });

  it('rejects alg:none and HS256', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(baseClaims)).toString('base64url');
    expect(verifyIdToken(`${header}.${payload}.`, opts)).toMatchObject({ ok: false });
    const hs = Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'test-key' })).toString('base64url');
    expect(verifyIdToken(`${hs}.${payload}.x`, opts)).toMatchObject({
      ok: false,
      reason: /unsupported alg/,
    });
  });

  it('parseJwt returns header + claims without verifying', () => {
    const p = parseJwt(signJwt(baseClaims));
    expect(p?.header.alg).toBe('RS256');
    expect(p?.claims.email).toBe('ada@nordwerk.example');
  });
});

describe('mapClaimsToRoleKeys', () => {
  const mapping = {
    defaultRoles: ['esg_analyst'],
    emailDomainRoles: { 'nordwerk.example': ['sustainability_manager'] },
    groupClaim: 'groups',
    groupRoles: { 'trace-admins': ['organization_admin'] },
  };

  it('always includes the defaults', () => {
    expect(mapClaimsToRoleKeys({ email: 'x@other.com' }, mapping)).toEqual(['esg_analyst']);
  });
  it('adds email-domain and group roles, de-duplicated', () => {
    const roles = mapClaimsToRoleKeys(
      { email: 'ada@nordwerk.example', groups: ['trace-admins', 'noise'] },
      mapping,
    );
    expect(new Set(roles)).toEqual(
      new Set(['esg_analyst', 'sustainability_manager', 'organization_admin']),
    );
  });
  it('accepts a space/comma-delimited groups string', () => {
    expect(mapClaimsToRoleKeys({ email: 'x@x', groups: 'trace-admins other' }, mapping)).toContain(
      'organization_admin',
    );
  });
});

describe('emailDomainAllowed', () => {
  it('allows any when the list is empty, else enforces membership', () => {
    expect(emailDomainAllowed('a@foo.com', [])).toBe(true);
    expect(emailDomainAllowed('a@foo.com', ['foo.com'])).toBe(true);
    expect(emailDomainAllowed('a@bar.com', ['foo.com'])).toBe(false);
  });
});
