import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  beginSsoLogin,
  completeSsoLogin,
  createPrisma,
  deleteIdentityProvider,
  getIdentityProvider,
  provisionOrganization,
  upsertIdentityProvider,
  verifyAuditChain,
  withOrgContext,
  type CompleteSsoLoginDeps,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

const ISSUER = 'https://idp.acme.test';
const CLIENT_ID = 'trace-acme';
const REDIRECT_URI = 'https://app.trace.test/cb';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const good = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkPublic = {
  ...(publicKey.export({ format: 'jwk' }) as Record<string, string>),
  kty: 'RSA',
  kid: 'k1',
  alg: 'RS256',
  use: 'sig',
};

function signJwt(claims: Record<string, unknown>, key = privateKey): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString(
    'base64url',
  );
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key).toString('base64url');
  return `${h}.${p}.${s}`;
}

function depsWithToken(idToken: string): CompleteSsoLoginDeps {
  return {
    exchangeCode: async () => ({ id_token: idToken }),
    fetchJwks: async () => ({ keys: [jwkPublic] }),
  };
}

run('SSO: OIDC login + JIT provisioning', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const slugA = `a-${orgA.slice(0, 8)}`;

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `oa-${userA}@test.example`, name: 'A' },
        { id: userB, email: `ob-${userB}@test.example`, name: 'B' },
      ],
    });
    for (const [org, user, slug] of [
      [orgA, userA, slugA],
      [orgB, userB, `b-${orgB.slice(0, 8)}`],
    ] as const) {
      await withOrgContext(
        org,
        (db) =>
          provisionOrganization(db, {
            organizationId: org,
            slug,
            legalName: 'Org',
            country: 'DE',
            creatorUserId: user,
            requestId: 'test',
          }),
        prisma,
      );
    }
    await withOrgContext(
      orgA,
      (db) =>
        upsertIdentityProvider(db, {
          organizationId: orgA,
          config: {
            enabled: true,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            clientSecret: 'super-secret',
            authorizationEndpoint: `${ISSUER}/authorize`,
            tokenEndpoint: `${ISSUER}/token`,
            jwksUri: `${ISSUER}/jwks`,
            scopes: 'openid email profile groups',
            roleMapping: {
              defaultRoles: ['esg_analyst'],
              emailDomainRoles: { 'acme.test': ['sustainability_manager'] },
              groupClaim: 'groups',
              groupRoles: { 'trace-admins': ['organization_admin'] },
            },
            allowedEmailDomains: ['acme.test'],
          },
          actorUserId: userA,
          requestId: 'test',
        }),
      prisma,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('exposes config without the client secret', async () => {
    const v = await withOrgContext(orgA, (db) => getIdentityProvider(db, orgA), prisma);
    expect(v).not.toBeNull();
    expect(JSON.stringify(v)).not.toContain('super-secret');
    expect(v!.linkedMembers).toBe(0);
    expect(v!.enabled).toBe(true);
  });

  async function begin() {
    const { authorizationUrl } = await beginSsoLogin(prisma, {
      orgSlug: slugA,
      redirectUri: REDIRECT_URI,
    });
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state')!;
    const req = await prisma.ssoLoginRequest.findUnique({ where: { state } });
    return { url, state, nonce: req!.nonce };
  }

  it('builds a PKCE authorization URL and stores single-use login state', async () => {
    const { url, state } = await begin();
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(state.length).toBeGreaterThan(20);
  });

  it('verifies the ID token, provisions a member with mapped roles, and links the identity', async () => {
    const { state, nonce } = await begin();
    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = signJwt({
      iss: ISSUER,
      sub: 'idp|ada',
      aud: CLIENT_ID,
      exp: nowSec + 300,
      iat: nowSec,
      nonce,
      email: 'ada@acme.test',
      name: 'Ada Byron',
      groups: ['trace-admins'],
    });
    const res = await completeSsoLogin(prisma, depsWithToken(idToken), {
      state,
      code: 'auth-code-1',
      redirectUri: REDIRECT_URI,
      requestId: 'test',
    });
    expect(res).toMatchObject({ organizationId: orgA, provisioned: true });
    expect(new Set(res.roleKeys)).toEqual(
      new Set(['esg_analyst', 'sustainability_manager', 'organization_admin']),
    );

    const user = await prisma.user.findUnique({ where: { email: 'ada@acme.test' } });
    expect(user?.externalId).toBe('idp|ada');
    const { membership, link, view } = await withOrgContext(
      orgA,
      async (db) => ({
        membership: await db.membership.findFirst({
          where: { organizationId: orgA, userId: user!.id },
          include: { roles: { include: { role: { select: { key: true } } } } },
        }),
        link: await db.ssoLink.findFirst({
          where: { organizationId: orgA, externalId: 'idp|ada' },
        }),
        view: await getIdentityProvider(db, orgA),
      }),
      prisma,
    );
    expect(membership?.status).toBe('active');
    expect(new Set(membership!.roles.map((r) => r.role.key))).toEqual(
      new Set(['esg_analyst', 'sustainability_manager', 'organization_admin']),
    );
    expect(link).not.toBeNull();
    expect(view!.linkedMembers).toBe(1);

    // The same state cannot be replayed.
    await expect(
      completeSsoLogin(prisma, depsWithToken(idToken), {
        state,
        code: 'auth-code-1',
        redirectUri: REDIRECT_URI,
        requestId: 'test',
      }),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it('a returning identity re-links without re-provisioning', async () => {
    const { state, nonce } = await begin();
    const nowSec = Math.floor(Date.now() / 1000);
    const res = await completeSsoLogin(
      prisma,
      depsWithToken(
        signJwt({
          iss: ISSUER,
          sub: 'idp|ada',
          aud: CLIENT_ID,
          exp: nowSec + 300,
          nonce,
          email: 'ada@acme.test',
        }),
      ),
      { state, code: 'c2', redirectUri: REDIRECT_URI, requestId: 'test' },
    );
    expect(res.provisioned).toBe(false);
  });

  it('rejects a disallowed email domain and a token signed by the wrong key', async () => {
    const a = await begin();
    let nowSec = Math.floor(Date.now() / 1000);
    await expect(
      completeSsoLogin(
        prisma,
        depsWithToken(
          signJwt({
            iss: ISSUER,
            sub: 'idp|bob',
            aud: CLIENT_ID,
            exp: nowSec + 300,
            nonce: a.nonce,
            email: 'bob@evil.test',
          }),
        ),
        { state: a.state, code: 'c3', redirectUri: REDIRECT_URI, requestId: 'test' },
      ),
    ).rejects.toThrow(/not permitted/i);

    const b = await begin();
    nowSec = Math.floor(Date.now() / 1000);
    await expect(
      completeSsoLogin(
        prisma,
        depsWithToken(
          signJwt(
            {
              iss: ISSUER,
              sub: 'idp|eve',
              aud: CLIENT_ID,
              exp: nowSec + 300,
              nonce: b.nonce,
              email: 'eve@acme.test',
            },
            good.privateKey,
          ),
        ),
        { state: b.state, code: 'c4', redirectUri: REDIRECT_URI, requestId: 'test' },
      ),
    ).rejects.toThrow(/token rejected/i);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bProvider = await withOrgContext(orgB, (db) => getIdentityProvider(db, orgB), prisma);
    expect(bProvider).toBeNull();
    const bCount = await withOrgContext(orgB, (db) => db.identityProvider.count(), prisma);
    expect(bCount).toBe(0);

    // cleanup keeps the suite idempotent
    await withOrgContext(
      orgA,
      (db) =>
        deleteIdentityProvider(db, { organizationId: orgA, actorUserId: userA, requestId: 'test' }),
      prisma,
    );
  });
});
