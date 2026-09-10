import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import {
  beginSamlLogin,
  completeSamlLogin,
  createPrisma,
  deleteSamlProvider,
  getSamlProvider,
  provisionOrganization,
  upsertSamlProvider,
  verifyAuditChain,
  withOrgContext,
  type PrismaClient,
} from '../../src/index';

const TEST_URL = process.env.DATABASE_URL_TEST;
const run = TEST_URL ? describe : describe.skip;

const IDP_ENTITY_ID = 'https://idp.acme.test/saml';
const ACS_URL = 'https://app.trace.test/api/v1/auth/saml/acme/acs';
const SP_ENTITY_ID = 'https://app.trace.test/api/v1/auth/saml/acme/metadata';

const idp = (() => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
})();

function assertionXml(inResponseTo: string, opts: { nameId?: string; email?: string } = {}): string {
  const now = Date.now();
  const iso = (ms: number) => new Date(now + ms).toISOString();
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${randomUUID().replace(/-/g, '')}" Version="2.0" IssueInstant="${iso(0)}">
    <saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${opts.nameId ?? 'acme|ada'}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="${inResponseTo}" Recipient="${ACS_URL}" NotOnOrAfter="${iso(5 * 60_000)}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(5 * 60_000)}">
      <saml:AudienceRestriction><saml:Audience>${SP_ENTITY_ID}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="_sess1">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email"><saml:AttributeValue>${opts.email ?? 'ada@acme.test'}</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="displayName"><saml:AttributeValue>Ada Lovelace</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="groups"><saml:AttributeValue>trace-admins</saml:AttributeValue></saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>`;
}

function signedResponse(inResponseTo: string, opts?: { nameId?: string; email?: string }, key = idp.privatePem): string {
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID().replace(/-/g, '')}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${ACS_URL}" InResponseTo="${inResponseTo}">
    <saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>
    <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
    ${assertionXml(inResponseTo, opts)}
  </samlp:Response>`;
  const sig = new SignedXml({ privateKey: key });
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  const ref = "//*[local-name(.)='Assertion']";
  sig.addReference({
    xpath: ref,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(xml, { location: { reference: ref, action: 'append' } });
  return Buffer.from(sig.getSignedXml()).toString('base64');
}

run('SSO: SAML login + JIT provisioning', () => {
  let prisma: PrismaClient;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const slugA = `sa-${orgA.slice(0, 8)}`;

  beforeAll(async () => {
    prisma = createPrisma(TEST_URL!);
    await prisma.user.createMany({
      data: [
        { id: userA, email: `sma-${userA}@test.example`, name: 'A' },
        { id: userB, email: `smb-${userB}@test.example`, name: 'B' },
      ],
    });
    for (const [org, user, slug] of [
      [orgA, userA, slugA],
      [orgB, userB, `sb-${orgB.slice(0, 8)}`],
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
        upsertSamlProvider(db, {
          organizationId: orgA,
          config: {
            enabled: true,
            idpEntityId: IDP_ENTITY_ID,
            ssoUrl: 'https://idp.acme.test/sso',
            certificates: [idp.publicPem],
            emailAttribute: 'email',
            nameAttribute: 'displayName',
            groupsAttribute: 'groups',
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

  async function begin() {
    const { redirectUrl } = await beginSamlLogin(prisma, {
      orgSlug: slugA,
      acsUrl: ACS_URL,
      spEntityId: SP_ENTITY_ID,
    });
    const url = new URL(redirectUrl);
    const relayState = url.searchParams.get('RelayState')!;
    const authn = inflateRawSync(
      Buffer.from(url.searchParams.get('SAMLRequest')!, 'base64'),
    ).toString();
    const requestId = /ID="([^"]+)"/.exec(authn)![1]!;
    return { relayState, requestId, url, authn };
  }

  it('exposes config and builds a deflated AuthnRequest redirect', async () => {
    const v = await withOrgContext(orgA, (db) => getSamlProvider(db, orgA), prisma);
    expect(v?.enabled).toBe(true);
    expect(v?.linkedMembers).toBe(0);

    const { url, authn, requestId } = await begin();
    expect(url.origin + url.pathname).toBe('https://idp.acme.test/sso');
    expect(authn).toContain(`AssertionConsumerServiceURL="${ACS_URL}"`);
    expect(requestId.startsWith('_')).toBe(true);
    const row = await prisma.samlLoginRequest.findUnique({ where: { samlRequestId: requestId } });
    expect(row).not.toBeNull();
  });

  it('verifies a signed assertion, provisions a member, and links the NameID', async () => {
    const { relayState, requestId } = await begin();
    const res = await completeSamlLogin(prisma, {
      samlResponse: signedResponse(requestId),
      relayState,
      acsUrl: ACS_URL,
      spEntityId: SP_ENTITY_ID,
      requestId: 'test',
    });
    expect(res).toMatchObject({ organizationId: orgA, provisioned: true });
    expect(new Set(res.roleKeys)).toEqual(
      new Set(['esg_analyst', 'sustainability_manager', 'organization_admin']),
    );

    const user = await prisma.user.findUnique({ where: { email: 'ada@acme.test' } });
    expect(user?.externalId).toBe('acme|ada');
    const { membership, link, view } = await withOrgContext(
      orgA,
      async (db) => ({
        membership: await db.membership.findFirst({
          where: { organizationId: orgA, userId: user!.id },
          include: { roles: { include: { role: { select: { key: true } } } } },
        }),
        link: await db.samlLink.findFirst({ where: { organizationId: orgA, nameId: 'acme|ada' } }),
        view: await getSamlProvider(db, orgA),
      }),
      prisma,
    );
    expect(membership?.status).toBe('active');
    expect(new Set(membership!.roles.map((r) => r.role.key))).toEqual(
      new Set(['esg_analyst', 'sustainability_manager', 'organization_admin']),
    );
    expect(link).not.toBeNull();
    expect(view!.linkedMembers).toBe(1);

    // The same RelayState cannot be replayed.
    await expect(
      completeSamlLogin(prisma, {
        samlResponse: signedResponse(requestId),
        relayState,
        acsUrl: ACS_URL,
        spEntityId: SP_ENTITY_ID,
        requestId: 'test',
      }),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it('a returning NameID re-links without re-provisioning', async () => {
    const { relayState, requestId } = await begin();
    const res = await completeSamlLogin(prisma, {
      samlResponse: signedResponse(requestId),
      relayState,
      acsUrl: ACS_URL,
      spEntityId: SP_ENTITY_ID,
      requestId: 'test',
    });
    expect(res.provisioned).toBe(false);
  });

  it('rejects a disallowed email domain and a wrong-key signature', async () => {
    const a = await begin();
    await expect(
      completeSamlLogin(prisma, {
        samlResponse: signedResponse(a.requestId, { nameId: 'acme|bob', email: 'bob@evil.test' }),
        relayState: a.relayState,
        acsUrl: ACS_URL,
        spEntityId: SP_ENTITY_ID,
        requestId: 'test',
      }),
    ).rejects.toThrow(/not permitted/i);

    const b = await begin();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(
      completeSamlLogin(prisma, {
        samlResponse: signedResponse(
          b.requestId,
          { nameId: 'acme|eve', email: 'eve@acme.test' },
          privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
        ),
        relayState: b.relayState,
        acsUrl: ACS_URL,
        spEntityId: SP_ENTITY_ID,
        requestId: 'test',
      }),
    ).rejects.toThrow(/response rejected/i);
  });

  it('keeps a verifiable audit chain and isolates tenants', async () => {
    const chain = await withOrgContext(orgA, (db) => verifyAuditChain(db, orgA), prisma);
    expect(chain.intact).toBe(true);

    const bProvider = await withOrgContext(orgB, (db) => getSamlProvider(db, orgB), prisma);
    expect(bProvider).toBeNull();
    const bCount = await withOrgContext(orgB, (db) => db.samlProvider.count(), prisma);
    expect(bCount).toBe(0);

    await withOrgContext(
      orgA,
      (db) => deleteSamlProvider(db, { organizationId: orgA, actorUserId: userA, requestId: 'test' }),
      prisma,
    );
  });
});
