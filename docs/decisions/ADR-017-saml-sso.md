# ADR-017: SAML 2.0 SSO + just-in-time provisioning

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13f

## Context

Phase 13e landed OpenID Connect SSO. Phase 13f adds the other enterprise-checklist
protocol: **per-organization SAML 2.0 Web-Browser-SSO with just-in-time membership
provisioning**. SCIM 2.0 provisioning and a real billing-provider integration stay
deferred — both need a live external system (an IdP that drives SCIM, a payment
provider) to exercise honestly, and are each their own phase.

Constraint that shaped the scope (unchanged from 13e): there is **no live IdP on
this host**. SAML's signature model is XML Digital Signature over canonicalised
XML — the one part of the flow where hand-rolling is a well-known security
foot-gun (XML-signature-wrapping, comment-splice and namespace-injection attacks).
So the design maximises what is genuinely testable offline and delegates the
canonicalisation + RSA verification to a vetted library.

## Options considered

### Signature verification

- **A1 — hand-roll exclusive XML canonicalisation + enveloped-signature digest +
  RSA verify with `node:crypto`.** Rejected: exc-c14n is subtle and a
  reimplementation is a plausible signature-bypass; contradicts "enterprise
  security day one / no security shortcuts".
- **A2 — `xml-crypto` (node-saml) + `@xmldom/xmldom`.** The de-facto Node SAML
  primitives, widely used and audited. `verifySamlResponse` reads identity only
  from `SignedXml.getSignedReferences()` — the bytes the library reports as
  covered by a verified signature — which structurally defeats XSW.
  - **Chosen.** Two new `@trace/domain` deps (pure computation, no network).

### On top of the library

`@trace/domain/access/saml.ts` adds, independent of `xml-crypto`:

- **exactly one `<saml:Assertion>`** (0 or >1 → reject; `EncryptedAssertion` → reject);
- **every `<ds:Signature>` must sit directly on the Response or that Assertion**
  (anywhere else → reject — the primary XSW position check);
- **RSA-SHA-256/384/512 only** — SHA-1 / rsa-sha1 signature and digest methods are
  rejected before the crypto call (mirrors 13e's "RS256 only");
- assertion-level signature required unless the admin opts out (`wantAssertionsSigned`);
- `Issuer` == configured IdP entityID; Status == `...:status:Success`;
- bearer `SubjectConfirmationData`: `Recipient` == our ACS URL, `InResponseTo` ==
  the AuthnRequest `ID` we stored, `NotOnOrAfter` in the future (±120 s skew);
- `Conditions` `NotBefore` / `NotOnOrAfter` window; `AudienceRestriction` contains
  our SP entityID (no `AudienceRestriction` → reject);
- response-level `Destination` / `InResponseTo` when present (defence in depth).

### Bindings

- **AuthnRequest:** SP-initiated, **HTTP-Redirect** binding — `SAMLRequest` is
  `base64(DEFLATE(xml))` (raw deflate), `RelayState` opaque. The request is **not
  signed** (SP request-signing needs an SP private key — a deliberate follow-up).
- **Assertion:** **HTTP-POST** binding to the ACS. The IdP posts straight to us,
  so — unlike OIDC — there is **no back-channel call** to inject; `@trace/db`
  calls `verifySamlResponse` directly.

### Login-state storage

- A single-use **`saml_login_request`** row holding `saml_request_id` (unique) and
  `relay_state` (unique), TTL 10 minutes, `consumed_at` set at the ACS. **Not
  RLS'd** — looked up by `relay_state` before any session or org context exists,
  exactly like `sso_login_request` / `magic_link_token`. The worker housekeeping
  pass prunes expired / consumed rows.

### Data model — separate from OIDC

- **B1 — extend `identity_provider` with nullable SAML columns, discriminate on
  `protocol`.** Rejected: makes every OIDC column nullable and forces
  non-null-assertion churn through the working 13e code.
- **B2 — parallel `saml_provider` / `saml_login_request` / `saml_link` models.**
  **Chosen.** Fully isolates SAML; mirrors the pattern where each phase adds its
  own tables and leaves prior code untouched. An org may in principle configure
  both; the login pages pick whichever protocol the member chose.

### JIT provisioning

- Reuses the 13e engine. `extractSamlIdentity` resolves email / name / groups from
  the configured attribute names (falling back to well-known attribute URIs, then
  the NameID for email), then `mapSamlToRoleKeys` feeds them through the shared
  `OidcRoleMapping` (default + email-domain + group roles). `allowedEmailDomains`
  (empty = any) gates provisioning; a mapping that resolves to no valid org role
  fails the login (`saml.no_roles`) rather than creating a role-less member.
  Existing members keep their roles — the mapping is applied only at first
  provisioning (same deliberate limitation as 13e).

### RLS boundary

- `saml_provider` (tenant config — signing certs are public, no secret stored) and
  `saml_link` (tenant data) → **RLS FORCE** on `current_org()`. The pre-auth flow
  resolves the org from the URL slug / the login-request row, then opens
  `withOrgContext`. `saml_login_request` is **not RLS'd** (see above).

## Decision

- **`@trace/domain/access/saml.ts`** (pure, + `xml-crypto` / `@xmldom/xmldom`):
  `generateSamlId` / `generateRelayState`, `buildAuthnRequestXml` +
  `buildRedirectBindingUrl` (DEFLATE + base64), `buildSpMetadataXml`,
  `normalizeCertificatePem`, `verifySamlResponse(xml, opts)` →
  `{ ok, nameId, nameIdFormat, sessionIndex, attributes } | { ok:false, reason }`,
  `extractSamlIdentity`, `mapSamlToRoleKeys`. 14 unit tests (real signing +
  verification with a throwaway RSA key, XSW rejection, tamper rejection,
  wrong-key rejection, every assertion check).
- **`@trace/db/saml.ts`**: `upsertSamlProvider` (validates the SSO URL is https,
  each certificate parses as an X.509 cert or public key, and every mapped role
  exists for the org; audit `saml.provider_configured` / `_updated`),
  `getSamlProvider` (adds `linkedMembers`), `deleteSamlProvider`,
  `beginSamlLogin(prisma, { orgSlug, acsUrl, spEntityId, redirectAfter? })` →
  `{ redirectUrl }`, `completeSamlLogin(prisma, { samlResponse, relayState,
  acsUrl, spEntityId })` → `{ userId, organizationId, roleKeys, provisioned,
  redirectAfter }` (no injected deps — POST binding), `listSamlLinks`,
  `pruneSamlLoginRequests`. New models `saml_provider` / `saml_login_request` /
  `saml_link`; migrations `0033_saml` + `0034_saml_rls` (RLS FORCE on
  `saml_provider` + `saml_link`).
- **`apps/api`**: `SsoModule` gains `SamlAuthController` (`GET
  /auth/saml/:slug/start` → 302 to the IdP; `POST /auth/saml/:slug/acs` → verify →
  JIT → session → 302 to the web; `GET /auth/saml/:slug/metadata` → SP metadata
  XML; all `@Public()` + `@MfaExempt()`; the ACS is CSRF-exempt because
  `@Public()` routes are; failures → `/login?sso_error=`) and `SamlConfigController`
  (`GET` / `PUT` / `DELETE /settings/saml` — `security.manage`).
- **`apps/worker`**: the housekeeping pass also runs `pruneSamlLoginRequests`.
- **`apps/web`**: `/login` gains a protocol selector (OpenID Connect / SAML 2.0)
  on the "Continue with SSO" box; Settings → **SAML SSO** — the config form
  (IdP entity ID + SSO URL + signing certificates, attribute mapping, the role
  mapping, allowed domains, enable) and the ACS URL / SP entity ID / metadata URL
  to register.
- **Seed**: a **disabled** demo SAML provider for the demo org (so magic-link
  login keeps working) with a throwaway signing key and a representative mapping.

## Consequences

- Two production dependencies enter `@trace/domain` (`xml-crypto`,
  `@xmldom/xmldom`). They perform no I/O; the domain module stays deterministic
  and offline-testable.
- MFA and SSO stay independent: a session established via SAML still passes the
  Phase-13b MFA gate if the user is enrolled or the org mandates it.
- One SAML provider per organization (`organization_id` unique on `saml_provider`).
- SP request-signing, IdP-initiated SSO (unsolicited `Response` with no
  `InResponseTo`), Single Logout, and encrypted assertions are all out of scope
  and explicitly rejected or unsupported.
- SCIM 2.0 provisioning and a real billing-provider integration are the only
  remaining Phase-13 items.
