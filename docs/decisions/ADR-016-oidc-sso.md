# ADR-016: OpenID Connect SSO + just-in-time provisioning

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13e

## Context

The identity slice of the final Phase-13 iteration: **per-organization OpenID
Connect sign-in with just-in-time membership provisioning**. SAML, SCIM, and a
real billing-provider integration stay deferred — SAML/SCIM need a live IdP to
exercise honestly, and payment wiring needs real credentials and is its own
phase.

Constraint that shaped the scope: there is **no live IdP on this host**. So the
design maximises what is genuinely testable offline — PKCE, the anti-forgery
tokens, and RS256 ID-token verification against a JWKS are all pure and unit-
tested with a throwaway RSA key; only the live redirect round-trip and the two
HTTP calls (token exchange, JWKS fetch) are injected and stubbed in the CI test.

## Options considered

### Protocol

- **A1 — SAML 2.0.** The enterprise-checklist protocol, but XML canonicalisation
  - enveloped-signature verification is only ever fixture-tested here, and the
    ACS round-trip cannot be exercised without an IdP.
- **A2 — OpenID Connect (authorization code + PKCE).** A modern, JSON/JWT flow;
  the security-critical parts (PKCE `S256`, `state`, `nonce`, RS256 signature,
  `iss` / `aud` / `exp` / `nonce` checks) are pure functions that a self-signed
  fixture fully covers.
  - **Chosen.** Highest honest test coverage per unit of code.

### Where the security logic lives

- **`@trace/domain/access/oidc.ts`** (pure): `generatePkce` / `pkceChallengeFor`,
  `randomUrlToken` (state / nonce), `buildAuthorizationUrl`, `verifyIdToken`
  (RS256 only — `alg:none` and HS\* are rejected outright; signature via
  `crypto.createPublicKey({format:'jwk'})` + `crypto.verify('RSA-SHA256')`; then
  `iss` / `aud` / `exp` (±120 s skew) / `nbf` / `sub` / `nonce`),
  `mapClaimsToRoleKeys` (default + email-domain + IdP-group → role keys),
  `emailDomainAllowed`. No network. 12 unit tests.

### Login-state storage

- **B1 — Encrypt the state into the `state` param.** Rejected: bigger URLs, key
  management, no server-side single-use guarantee.
- **B2 — A single-use `sso_login_request` row** holding `state` (unique),
  `nonce`, and the PKCE `verifier`, expiring in 10 minutes and marked
  `consumed_at` at the callback. **Not RLS'd** — it is looked up by `state`
  _before_ any session or org context exists, exactly like `magic_link_token`.
  A worker sweep prunes expired / consumed rows.
  - **Chosen.**

### JIT provisioning

- The callback verifies the token, enforces `allowedEmailDomains` (empty = any),
  upserts the platform `user` by email (`external_id` = the `sub` claim), then in
  `withOrgContext`: upserts an `sso_link` (`(provider, external_id)` unique), and
  **creates a `membership`** with the roles from `mapClaimsToRoleKeys` if none
  exists (a re-activation if it was suspended). Existing members keep their roles
  — the mapping does not overwrite on every login. A mapping that resolves to no
  valid org role fails the login (`sso.no_roles`) rather than creating a
  role-less member.

### RLS boundary

- `identity_provider` (holds the client secret) and `sso_link` are tenant config
  / tenant data → **RLS FORCE**. The pre-auth flow resolves the org from the URL
  slug / the login-request row, then opens `withOrgContext` to read the provider
  and write the link. `sso_login_request` is **not RLS'd** (see B2).

## Decision

- **`@trace/domain`**: `oidc.ts` as above.
- **`@trace/db/sso.ts`**: `upsertIdentityProvider` (validates https endpoints and
  that every mapped role exists in the org; `clientSecret` optional on update;
  audit `sso.provider_configured` / `_updated`), `getIdentityProvider` (never
  returns the secret) + `deleteIdentityProvider`, `beginSsoLogin(prisma, {
orgSlug, redirectUri, redirectAfter? })` → `{ authorizationUrl }`,
  `completeSsoLogin(prisma, deps, { state, code, redirectUri })` → `{ userId,
organizationId, roleKeys, provisioned, redirectAfter }` (`deps.exchangeCode`
  and `deps.fetchJwks` are injected), `listSsoLinks`, `pruneSsoLoginRequests`.
  New models `identity_provider` / `sso_login_request` / `sso_link` +
  `user.external_id`; migrations `0031_sso` + `0032_sso_rls` (RLS FORCE on
  `identity_provider` + `sso_link`).
- **`apps/api`**: `SsoModule` — `SsoAuthController` (`GET /auth/sso/:slug/start`
  → 302 to the IdP; `GET /auth/sso/:slug/callback` → verify → JIT → session →
  302 to the web; both `@Public()` + `@MfaExempt()`; errors redirect to
  `/login?sso_error=`), `SsoConfigController` (`GET` / `PUT` / `DELETE
/settings/sso` + `POST /settings/sso/discover` — `security.manage`). The real
  token-exchange and JWKS fetch use global `fetch` with an 8 s timeout.
- **`apps/worker`**: the periodic housekeeping pass also runs
  `pruneSsoLoginRequests`.
- **`apps/web`**: `/login` gains a "Continue with SSO" box (workspace slug →
  `/auth/sso/:slug/start`) and surfaces `?sso_error=`. Settings → **Single
  Sign-On** — the OIDC config form (issuer + Discover, endpoints, client
  credentials, scopes, the role mapping, allowed domains, enable) and the
  redirect URI to register.
- **Seed**: a **disabled** demo OIDC provider for the demo org (so magic-link
  login keeps working) with a representative role mapping.

## Consequences

- MFA and SSO are independent: a session established via SSO still goes through
  the Phase-13b MFA gate if the user is enrolled or the org mandates it.
- `client_secret` is stored in `identity_provider` to perform the code exchange;
  it should be encrypted at rest in production (same open item as
  `webhook_endpoint.secret` / `audit_stream.secret`).
- One IdP per organization for now (`organization_id` is unique on
  `identity_provider`); multiple providers / provider priority is a follow-up.
- The role mapping is applied only at first provisioning; syncing roles on every
  login (with de-provisioning) is a deliberate follow-up, not a silent behaviour.
- SAML, SCIM, and a real billing-provider integration are the only remaining
  Phase-13 items.
