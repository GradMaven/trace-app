import { generateKeyPairSync } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import {
  buildAuthnRequestXml,
  buildRedirectBindingUrl,
  buildSpMetadataXml,
  extractSamlIdentity,
  generateRelayState,
  generateSamlId,
  mapSamlToRoleKeys,
  normalizeCertificatePem,
  verifySamlResponse,
} from './saml';

// --- throwaway RSA keypairs -------------------------------------------------

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}
const idp = keypair();
const wrong = keypair();

const SP_ENTITY_ID = 'https://app.trace.test/api/v1/auth/saml/acme/metadata';
const ACS_URL = 'https://app.trace.test/api/v1/auth/saml/acme/acs';
const IDP_ENTITY_ID = 'https://idp.acme.test/saml';
const REQUEST_ID = '_req00000000000000000000';

interface AssertionOpts {
  now?: Date;
  recipient?: string;
  inResponseTo?: string;
  audience?: string;
  issuer?: string;
  notOnOrAfterMs?: number;
  attributes?: string;
  nameId?: string;
}

function assertionXml(o: AssertionOpts = {}): string {
  const now = o.now ?? new Date();
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const notOnOrAfter = iso(o.notOnOrAfterMs ?? 5 * 60_000);
  const attrs =
    o.attributes ??
    `<saml:AttributeStatement>
       <saml:Attribute Name="email"><saml:AttributeValue>ada@acme.test</saml:AttributeValue></saml:Attribute>
       <saml:Attribute Name="displayName"><saml:AttributeValue>Ada Lovelace</saml:AttributeValue></saml:Attribute>
       <saml:Attribute Name="groups">
         <saml:AttributeValue>trace-admins</saml:AttributeValue>
         <saml:AttributeValue>engineering</saml:AttributeValue>
       </saml:Attribute>
     </saml:AttributeStatement>`;
  return `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assert00000000000000001" Version="2.0" IssueInstant="${iso(0)}">
    <saml:Issuer>${o.issuer ?? IDP_ENTITY_ID}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${o.nameId ?? 'acme|ada'}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="${o.inResponseTo ?? REQUEST_ID}" Recipient="${o.recipient ?? ACS_URL}" NotOnOrAfter="${notOnOrAfter}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${notOnOrAfter}">
      <saml:AudienceRestriction><saml:Audience>${o.audience ?? SP_ENTITY_ID}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="_sess123">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    ${attrs}
  </saml:Assertion>`;
}

function responseXml(assertion: string, status = 'urn:oasis:names:tc:SAML:2.0:status:Success'): string {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp0000000000000000001" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="${ACS_URL}" InResponseTo="${REQUEST_ID}">
    <saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>
    <samlp:Status><samlp:StatusCode Value="${status}"/></samlp:Status>
    ${assertion}
  </samlp:Response>`;
}

function sign(
  responseXmlStr: string,
  target: 'assertion' | 'response' = 'assertion',
  key = idp.privatePem,
): string {
  const sig = new SignedXml({ privateKey: key });
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  const ref =
    target === 'assertion'
      ? "//*[local-name(.)='Assertion']"
      : "//*[local-name(.)='Response']";
  sig.addReference({
    xpath: ref,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(responseXmlStr, { location: { reference: ref, action: 'append' } });
  return sig.getSignedXml();
}

const baseOpts = {
  certificatesPem: [idp.publicPem],
  spEntityId: SP_ENTITY_ID,
  acsUrl: ACS_URL,
  expectedInResponseTo: REQUEST_ID,
  idpEntityId: IDP_ENTITY_ID,
};

describe('AuthnRequest + redirect binding', () => {
  it('builds a deflated, base64 SAMLRequest with RelayState', () => {
    const xml = buildAuthnRequestXml({
      spEntityId: SP_ENTITY_ID,
      acsUrl: ACS_URL,
      idpSsoUrl: 'https://idp.acme.test/sso',
      requestId: '_abc',
    });
    expect(xml).toContain('AssertionConsumerServiceURL="https://app.trace.test/api/v1/auth/saml/acme/acs"');
    const url = new URL(buildRedirectBindingUrl('https://idp.acme.test/sso', xml, 'rs-1'));
    expect(url.searchParams.get('RelayState')).toBe('rs-1');
    const back = inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest')!, 'base64')).toString();
    expect(back).toBe(xml);
  });

  it('ids start with an underscore and are unique', () => {
    expect(generateSamlId()).toMatch(/^_[0-9a-f]{40}$/);
    expect(generateSamlId()).not.toBe(generateSamlId());
    expect(generateRelayState()).not.toMatch(/[+/=]/);
  });

  it('SP metadata advertises the ACS and WantAssertionsSigned', () => {
    const md = buildSpMetadataXml({ spEntityId: SP_ENTITY_ID, acsUrl: ACS_URL });
    expect(md).toContain(`entityID="${SP_ENTITY_ID}"`);
    expect(md).toContain('WantAssertionsSigned="true"');
    expect(md).toContain(`Location="${ACS_URL}"`);
  });
});

describe('normalizeCertificatePem', () => {
  it('wraps a bare base64 body and passes PEM through', () => {
    const wrapped = normalizeCertificatePem('QUJDREVG');
    expect(wrapped.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    expect(normalizeCertificatePem(idp.publicPem)).toBe(idp.publicPem.trim());
  });
});

describe('verifySamlResponse', () => {
  it('accepts a correctly signed assertion and returns identity + attributes', () => {
    const res = verifySamlResponse(sign(responseXml(assertionXml())), baseOpts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.nameId).toBe('acme|ada');
    expect(res.sessionIndex).toBe('_sess123');
    expect(res.attributes.email).toEqual(['ada@acme.test']);
    expect(res.attributes.groups).toEqual(['trace-admins', 'engineering']);
  });

  it('accepts a response-level signature when assertion signing is not required', () => {
    const res = verifySamlResponse(sign(responseXml(assertionXml()), 'response'), {
      ...baseOpts,
      wantAssertionsSigned: false,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects an unsigned response', () => {
    expect(verifySamlResponse(responseXml(assertionXml()), baseOpts)).toMatchObject({
      ok: false,
      reason: /not signed/,
    });
  });

  it('rejects a signature made with the wrong key', () => {
    const res = verifySamlResponse(sign(responseXml(assertionXml()), 'assertion', wrong.privatePem), baseOpts);
    expect(res.ok).toBe(false);
  });

  it('rejects a tampered attribute after signing', () => {
    const signed = sign(responseXml(assertionXml())).replace('ada@acme.test', 'evil@acme.test');
    expect(verifySamlResponse(signed, baseOpts)).toMatchObject({ ok: false });
  });

  it('rejects a wrapped extra assertion', () => {
    const inner = assertionXml();
    const evil = assertionXml({ nameId: 'acme|evil' });
    const signed = sign(responseXml(inner));
    const wrapped = signed.replace('</samlp:Response>', `${evil}</samlp:Response>`);
    expect(verifySamlResponse(wrapped, baseOpts)).toMatchObject({
      ok: false,
      reason: /exactly one assertion/,
    });
  });

  it('enforces Recipient, InResponseTo, Audience, Issuer and the time window', () => {
    expect(
      verifySamlResponse(sign(responseXml(assertionXml({ recipient: 'https://evil.test/acs' }))), baseOpts),
    ).toMatchObject({ ok: false, reason: /Recipient/ });
    expect(
      verifySamlResponse(sign(responseXml(assertionXml({ inResponseTo: '_other' }))), baseOpts),
    ).toMatchObject({ ok: false, reason: /InResponseTo/ });
    expect(
      verifySamlResponse(sign(responseXml(assertionXml({ audience: 'https://someone.else' }))), baseOpts),
    ).toMatchObject({ ok: false, reason: /audience/ });
    expect(
      verifySamlResponse(sign(responseXml(assertionXml({ issuer: 'https://evil.test' }))), baseOpts),
    ).toMatchObject({ ok: false, reason: /issuer/ });
    expect(
      verifySamlResponse(
        sign(responseXml(assertionXml({ notOnOrAfterMs: -10 * 60_000 }))),
        baseOpts,
      ),
    ).toMatchObject({ ok: false, reason: /expired/ });
  });

  it('rejects a non-Success status', () => {
    const res = verifySamlResponse(
      sign(responseXml(assertionXml(), 'urn:oasis:names:tc:SAML:2.0:status:Requester')),
      baseOpts,
    );
    expect(res).toMatchObject({ ok: false, reason: /status/ });
  });
});

describe('extractSamlIdentity + mapSamlToRoleKeys', () => {
  const roleMapping = {
    defaultRoles: ['esg_analyst'],
    emailDomainRoles: { 'acme.test': ['sustainability_manager'] },
    groupClaim: 'groups',
    groupRoles: { 'trace-admins': ['organization_admin'] },
  };

  it('reads email/name/groups with attribute fallbacks', () => {
    const id = extractSamlIdentity(
      { nameId: 'acme|ada', nameIdFormat: null, sessionIndex: null, attributes: { email: ['Ada@ACME.test'], groups: ['trace-admins'] } },
      {},
    );
    expect(id.email).toBe('ada@acme.test');
    expect(id.groups).toEqual(['trace-admins']);
    expect(mapSamlToRoleKeys(id.email, id.groups, roleMapping).sort()).toEqual(
      ['esg_analyst', 'organization_admin', 'sustainability_manager'].sort(),
    );
  });

  it('falls back to the NameID when it is an email and no email attribute is present', () => {
    const id = extractSamlIdentity(
      { nameId: 'ada@acme.test', nameIdFormat: null, sessionIndex: null, attributes: {} },
      {},
    );
    expect(id.email).toBe('ada@acme.test');
  });
});
