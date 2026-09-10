import { randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { mapClaimsToRoleKeys, type OidcRoleMapping } from './oidc';

/**
 * SAML 2.0 Web-Browser-SSO helpers (Phase 13f) — pure. AuthnRequest construction
 * for the HTTP-Redirect binding, SP metadata, and full validation of a SAML
 * Response received on the HTTP-POST binding: XML-DSig signature verification
 * (delegated to `xml-crypto` / node-saml — hand-rolling XML canonicalisation is a
 * known foot-gun), plus every non-signature check (Status, Issuer, the
 * SubjectConfirmation window, Conditions / Audience, InResponseTo correlation).
 *
 * This module performs NO network I/O. On the POST binding the IdP delivers the
 * assertion straight to the ACS, so — unlike OIDC — there is no back-channel call
 * to inject; `@trace/db` calls `verifySamlResponse` directly.
 *
 * The SAML role mapping reuses the OIDC `OidcRoleMapping` shape (default roles +
 * email-domain roles + IdP-group roles).
 */

export const SAML_LOGIN_TTL_SECONDS = 600;
export const SAML_CLOCK_SKEW_SECONDS = 120;

export const SAMLP_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
export const SAML_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
export const MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
export const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

const STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';
const BEARER_METHOD = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';
export const NAMEID_PERSISTENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';
const HTTP_POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const HTTP_REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

const ALLOWED_SIGNATURE_METHODS = new Set([
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
]);
const ALLOWED_DIGEST_METHODS = new Set([
  'http://www.w3.org/2001/04/xmlenc#sha256',
  'http://www.w3.org/2001/04/xmldsig-more#sha384',
  'http://www.w3.org/2001/04/xmlenc#sha512',
]);

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** A SAML `xsd:ID` — must start with a letter or underscore. */
export function generateSamlId(): string {
  return `_${randomBytes(20).toString('hex')}`;
}

export function generateRelayState(): string {
  return randomBytes(24).toString('base64url');
}

// ---------------------------------------------------------------------------
// XML escaping (attribute + text)
// ---------------------------------------------------------------------------

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// AuthnRequest (SP-initiated) + HTTP-Redirect binding
// ---------------------------------------------------------------------------

export interface AuthnRequestInput {
  spEntityId: string;
  acsUrl: string;
  idpSsoUrl: string;
  /** Pre-generated (stored so the callback can check `InResponseTo`). */
  requestId: string;
  issueInstant?: Date;
  forceAuthn?: boolean;
  nameIdFormat?: string;
}

export function buildAuthnRequestXml(input: AuthnRequestInput): string {
  const instant = (input.issueInstant ?? new Date()).toISOString();
  const format = input.nameIdFormat ?? NAMEID_PERSISTENT;
  return (
    `<samlp:AuthnRequest xmlns:samlp="${SAMLP_NS}" xmlns:saml="${SAML_NS}" ` +
    `ID="${xmlEscape(input.requestId)}" Version="2.0" IssueInstant="${instant}" ` +
    `Destination="${xmlEscape(input.idpSsoUrl)}" ` +
    `ProtocolBinding="${HTTP_POST_BINDING}" ` +
    `AssertionConsumerServiceURL="${xmlEscape(input.acsUrl)}"` +
    (input.forceAuthn ? ' ForceAuthn="true"' : '') +
    '>' +
    `<saml:Issuer>${xmlEscape(input.spEntityId)}</saml:Issuer>` +
    `<samlp:NameIDPolicy Format="${xmlEscape(format)}" AllowCreate="true"/>` +
    '</samlp:AuthnRequest>'
  );
}

/**
 * The redirect URL for the HTTP-Redirect binding: `SAMLRequest` is
 * `base64(DEFLATE(xml))` (raw deflate, no zlib header), `RelayState` round-trips
 * opaque client state. The request is not signed — SP request-signing needs the
 * SP private key and is a deliberate follow-up.
 */
export function buildRedirectBindingUrl(
  idpSsoUrl: string,
  authnRequestXml: string,
  relayState: string,
): string {
  const deflated = deflateRawSync(Buffer.from(authnRequestXml, 'utf8')).toString('base64');
  const url = new URL(idpSsoUrl);
  url.searchParams.set('SAMLRequest', deflated);
  url.searchParams.set('RelayState', relayState);
  return url.toString();
}

// ---------------------------------------------------------------------------
// SP metadata
// ---------------------------------------------------------------------------

export function buildSpMetadataXml(input: {
  spEntityId: string;
  acsUrl: string;
  wantAssertionsSigned?: boolean;
}): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<md:EntityDescriptor xmlns:md="${MD_NS}" entityID="${xmlEscape(input.spEntityId)}">` +
    '<md:SPSSODescriptor AuthnRequestsSigned="false" ' +
    `WantAssertionsSigned="${input.wantAssertionsSigned === false ? 'false' : 'true'}" ` +
    'protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">' +
    `<md:NameIDFormat>${NAMEID_PERSISTENT}</md:NameIDFormat>` +
    `<md:AssertionConsumerService Binding="${HTTP_POST_BINDING}" ` +
    `Location="${xmlEscape(input.acsUrl)}" index="0" isDefault="true"/>` +
    '</md:SPSSODescriptor>' +
    '</md:EntityDescriptor>'
  );
}

// ---------------------------------------------------------------------------
// Certificate normalisation
// ---------------------------------------------------------------------------

/** Wrap a bare base64 X.509 body in PEM armour; pass through existing PEM. */
export function normalizeCertificatePem(raw: string): string {
  const trimmed = raw.trim();
  if (/-----BEGIN [A-Z ]+-----/.test(trimmed)) return trimmed;
  const body = trimmed.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

// ---------------------------------------------------------------------------
// SAML Response validation
// ---------------------------------------------------------------------------

export interface VerifySamlResponseOptions {
  /** IdP signing certificate(s) — PEM cert or PEM public key. Any one must verify. */
  certificatesPem: string[];
  /** Our SP entityID; must appear in the assertion's AudienceRestriction. */
  spEntityId: string;
  /** Our ACS URL; must equal the SubjectConfirmationData `Recipient`. */
  acsUrl: string;
  /** The `ID` of the AuthnRequest we sent; must equal `InResponseTo`. */
  expectedInResponseTo: string;
  /** The IdP entityID we configured; must equal the assertion `Issuer`. */
  idpEntityId: string;
  /** Require an assertion-level signature (default true). */
  wantAssertionsSigned?: boolean;
  now?: Date;
  clockSkewSeconds?: number;
}

export interface SamlAssertionData {
  nameId: string;
  nameIdFormat: string | null;
  sessionIndex: string | null;
  attributes: Record<string, string[]>;
}

export type VerifySamlResponseResult =
  | ({ ok: true } & SamlAssertionData)
  | { ok: false; reason: string };

function parseXml(xml: string): Document | null {
  let errored = false;
  const doc = new DOMParser({
    onError: (level) => {
      if (level === 'error' || level === 'fatalError') errored = true;
    },
  }).parseFromString(xml, 'text/xml');
  if (errored || !doc || !doc.documentElement) return null;
  return doc;
}

function els(parent: Element | Document, ns: string, local: string): Element[] {
  const list = parent.getElementsByTagNameNS(ns, local);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const node = list.item(i);
    if (node) out.push(node);
  }
  return out;
}
function firstEl(parent: Element | Document, ns: string, local: string): Element | null {
  return els(parent, ns, local)[0] ?? null;
}
function text(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}
function attr(el: Element | null, name: string): string | null {
  const v = el?.getAttribute(name);
  return v && v.length > 0 ? v : null;
}
function parseInstant(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Verify a base64-decoded SAML Response XML string. Reads identity only from the
 * bytes that `xml-crypto` reports as covered by a verified signature
 * (`getSignedReferences()`), which defeats XML-signature-wrapping. On top of the
 * library check: exactly one assertion, every `<ds:Signature>` must sit directly
 * on the Response or that Assertion, and only RSA-SHA-256/384/512 is accepted.
 */
export function verifySamlResponse(
  xml: string,
  opts: VerifySamlResponseOptions,
): VerifySamlResponseResult {
  const skew = (opts.clockSkewSeconds ?? SAML_CLOCK_SKEW_SECONDS) * 1000;
  const now = (opts.now ?? new Date()).getTime();

  const doc = parseXml(xml);
  if (!doc) return { ok: false, reason: 'malformed XML' };

  const response = doc.documentElement;
  if (!response || response.localName !== 'Response' || response.namespaceURI !== SAMLP_NS) {
    return { ok: false, reason: 'root element is not a samlp:Response' };
  }

  // Status
  const statusCode = attr(firstEl(response, SAMLP_NS, 'StatusCode'), 'Value');
  if (statusCode !== STATUS_SUCCESS) {
    return { ok: false, reason: `status ${statusCode ?? 'missing'}` };
  }

  if (els(response, SAML_NS, 'EncryptedAssertion').length > 0) {
    return { ok: false, reason: 'encrypted assertions are not supported' };
  }
  const assertions = els(response, SAML_NS, 'Assertion');
  if (assertions.length !== 1) {
    return { ok: false, reason: `expected exactly one assertion, found ${assertions.length}` };
  }
  const assertionEl = assertions[0]!;

  // --- signature position + algorithm gate ---------------------------------
  const signatures = els(doc, DSIG_NS, 'Signature');
  if (signatures.length === 0) return { ok: false, reason: 'response is not signed' };
  for (const sig of signatures) {
    const parent = sig.parentNode;
    if (parent !== response && parent !== assertionEl) {
      return { ok: false, reason: 'signature in an unexpected position' };
    }
  }
  const assertionSig = signatures.find((s) => s.parentNode === assertionEl) ?? null;
  const responseSig = signatures.find((s) => s.parentNode === response) ?? null;
  if (opts.wantAssertionsSigned !== false && !assertionSig) {
    return { ok: false, reason: 'assertion is not signed' };
  }
  const chosenSig = assertionSig ?? responseSig!;
  const coveredEl = assertionSig ? assertionEl : response;

  const sigMethod = attr(firstEl(chosenSig, DSIG_NS, 'SignatureMethod'), 'Algorithm');
  const digMethod = attr(firstEl(chosenSig, DSIG_NS, 'DigestMethod'), 'Algorithm');
  if (!sigMethod || !ALLOWED_SIGNATURE_METHODS.has(sigMethod)) {
    return { ok: false, reason: `weak or missing signature method ${sigMethod ?? ''}`.trim() };
  }
  if (!digMethod || !ALLOWED_DIGEST_METHODS.has(digMethod)) {
    return { ok: false, reason: `weak or missing digest method ${digMethod ?? ''}`.trim() };
  }

  // --- cryptographic verification via xml-crypto -------------------------
  const coveredId = attr(coveredEl, 'ID');
  if (!coveredId) return { ok: false, reason: 'signed element has no ID' };

  let signedXmlStr: string | null = null;
  let lastError = 'signature did not verify';
  for (const pem of opts.certificatesPem) {
    const verifier = new SignedXml();
    verifier.publicCert = pem;
    // Never trust a certificate embedded in the document's own KeyInfo.
    verifier.getCertFromKeyInfo = () => null;
    try {
      verifier.loadSignature(chosenSig);
      const valid = verifier.checkSignature(xml);
      if (!valid) continue;
      const refs = verifier.getReferences();
      if (refs.length !== 1) {
        lastError = `signature covers ${refs.length} references`;
        continue;
      }
      const refUri = (refs[0]?.uri ?? '').replace(/^#/, '');
      if (refUri !== coveredId) {
        lastError = 'signature reference does not cover the assertion';
        continue;
      }
      const signed = verifier.getSignedReferences();
      if (signed.length !== 1 || !signed[0]) {
        lastError = 'no signed content';
        continue;
      }
      signedXmlStr = signed[0];
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'signature error';
    }
  }
  if (!signedXmlStr) return { ok: false, reason: lastError };

  // --- read identity ONLY from the verified bytes -----------------------
  const signedDoc = parseXml(signedXmlStr);
  if (!signedDoc || !signedDoc.documentElement) {
    return { ok: false, reason: 'verified content did not parse' };
  }
  const signedAssertion =
    signedDoc.documentElement.localName === 'Assertion'
      ? signedDoc.documentElement
      : (els(signedDoc, SAML_NS, 'Assertion')[0] ?? null);
  if (!signedAssertion || signedAssertion.namespaceURI !== SAML_NS) {
    return { ok: false, reason: 'no assertion in the verified content' };
  }

  if (text(firstEl(signedAssertion, SAML_NS, 'Issuer')) !== opts.idpEntityId) {
    return { ok: false, reason: 'issuer mismatch' };
  }

  const subject = firstEl(signedAssertion, SAML_NS, 'Subject');
  const nameIdEl = subject ? firstEl(subject, SAML_NS, 'NameID') : null;
  const nameId = text(nameIdEl);
  if (!nameId) return { ok: false, reason: 'no NameID in the subject' };

  const confirmationData = subject
    ? els(subject, SAML_NS, 'SubjectConfirmation')
        .filter((c) => attr(c, 'Method') === BEARER_METHOD)
        .map((c) => firstEl(c, SAML_NS, 'SubjectConfirmationData'))
        .find((d): d is Element => d !== null) ?? null
    : null;
  if (!confirmationData) return { ok: false, reason: 'no bearer SubjectConfirmationData' };
  if (attr(confirmationData, 'Recipient') !== opts.acsUrl) {
    return { ok: false, reason: 'SubjectConfirmationData Recipient mismatch' };
  }
  if (attr(confirmationData, 'InResponseTo') !== opts.expectedInResponseTo) {
    return { ok: false, reason: 'InResponseTo mismatch' };
  }
  const scdNotOnOrAfter = parseInstant(attr(confirmationData, 'NotOnOrAfter'));
  if (scdNotOnOrAfter === null || scdNotOnOrAfter + skew <= now) {
    return { ok: false, reason: 'subject confirmation expired' };
  }

  const conditions = firstEl(signedAssertion, SAML_NS, 'Conditions');
  if (conditions) {
    const notBefore = parseInstant(attr(conditions, 'NotBefore'));
    const notOnOrAfter = parseInstant(attr(conditions, 'NotOnOrAfter'));
    if (notBefore !== null && notBefore - skew > now) {
      return { ok: false, reason: 'assertion not yet valid' };
    }
    if (notOnOrAfter !== null && notOnOrAfter + skew <= now) {
      return { ok: false, reason: 'assertion expired' };
    }
  }
  const audiences = els(signedAssertion, SAML_NS, 'Audience').map((a) => text(a));
  if (audiences.length === 0) return { ok: false, reason: 'no AudienceRestriction' };
  if (!audiences.includes(opts.spEntityId)) {
    return { ok: false, reason: 'audience mismatch' };
  }

  // Response-level defence-in-depth (attributes are not in the signed assertion).
  const destination = attr(response, 'Destination');
  if (destination !== null && destination !== opts.acsUrl) {
    return { ok: false, reason: 'response Destination mismatch' };
  }
  const responseInResponseTo = attr(response, 'InResponseTo');
  if (responseInResponseTo !== null && responseInResponseTo !== opts.expectedInResponseTo) {
    return { ok: false, reason: 'response InResponseTo mismatch' };
  }

  const authnStatement = firstEl(signedAssertion, SAML_NS, 'AuthnStatement');

  const attributes: Record<string, string[]> = {};
  for (const attrEl of els(signedAssertion, SAML_NS, 'Attribute')) {
    const name = attr(attrEl, 'Name');
    if (!name) continue;
    const values = els(attrEl, SAML_NS, 'AttributeValue')
      .map((v) => text(v))
      .filter((v) => v.length > 0);
    attributes[name] = (attributes[name] ?? []).concat(values);
  }

  return {
    ok: true,
    nameId,
    nameIdFormat: attr(nameIdEl, 'Format'),
    sessionIndex: attr(authnStatement, 'SessionIndex'),
    attributes,
  };
}

// ---------------------------------------------------------------------------
// Attribute → identity + role mapping
// ---------------------------------------------------------------------------

export interface SamlAttributeMapping {
  /** Attribute carrying the email; falls back to well-known names, then the NameID. */
  emailAttribute?: string;
  /** Attribute carrying the display name. */
  nameAttribute?: string;
  /** Attribute carrying the group list; falls back to well-known names. */
  groupsAttribute?: string;
}

const WELL_KNOWN_EMAIL_ATTRS = [
  'email',
  'mail',
  'emailAddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'urn:oid:1.2.840.113549.1.9.1',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
];
const WELL_KNOWN_NAME_ATTRS = [
  'name',
  'displayName',
  'cn',
  'urn:oid:2.16.840.1.113730.3.1.241',
  'urn:oid:2.5.4.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];
const WELL_KNOWN_GROUP_ATTRS = [
  'groups',
  'Groups',
  'memberOf',
  'http://schemas.xmlsoap.org/claims/Group',
];

function pickAttr(
  attributes: Record<string, string[]>,
  preferred: string | undefined,
  wellKnown: string[],
): string[] {
  if (preferred && attributes[preferred]?.length) return attributes[preferred]!;
  for (const key of wellKnown) {
    if (attributes[key]?.length) return attributes[key]!;
  }
  return [];
}

export function extractSamlIdentity(
  data: SamlAssertionData,
  mapping: SamlAttributeMapping,
): { email: string; name: string; groups: string[] } {
  const emailFromAttr = pickAttr(data.attributes, mapping.emailAttribute, WELL_KNOWN_EMAIL_ATTRS)[0];
  const nameIdIsEmail = data.nameId.includes('@');
  const email = (emailFromAttr ?? (nameIdIsEmail ? data.nameId : '')).trim().toLowerCase();
  const name =
    pickAttr(data.attributes, mapping.nameAttribute, WELL_KNOWN_NAME_ATTRS)[0]?.trim() ||
    (email ? emailLocalPartName(email) : data.nameId);
  const groups = pickAttr(data.attributes, mapping.groupsAttribute, WELL_KNOWN_GROUP_ATTRS);
  return { email, name, groups };
}

/** Resolve org role keys for a SAML login — reuses the OIDC role-mapping engine. */
export function mapSamlToRoleKeys(
  email: string,
  groups: string[],
  mapping: OidcRoleMapping,
): string[] {
  const groupClaim = mapping.groupClaim ?? 'groups';
  return mapClaimsToRoleKeys({ email, [groupClaim]: groups }, mapping);
}

function emailLocalPartName(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export const SAML_HTTP_POST_BINDING = HTTP_POST_BINDING;
export const SAML_HTTP_REDIRECT_BINDING = HTTP_REDIRECT_BINDING;
