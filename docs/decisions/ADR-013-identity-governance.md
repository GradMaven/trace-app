# ADR-013: Enterprise identity & governance — MFA, data export, retention

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13b

## Context

Phase 13a took the offline-buildable half of "enterprise readiness" (API keys,
webhooks, custom roles). Phase 13b takes the account-security + data-governance
slice: **TOTP two-factor auth, full-tenant data export, and data-retention
policies**. SSO (OIDC/SAML) and SCIM are still deferred — they need a real IdP to
exercise honestly, and a stubbed SAML flow would be a fabricated security claim.

Constraints unchanged: RLS on every tenant table; append-only hash-chained audit
log; "TRACE keeps the spine" — evidence, calculations, datapoints and the audit
log are never destroyed by a product feature.

## Options considered

### MFA factor

- **A1 — SMS / email OTP.** Rejected: weak (SIM-swap, inbox compromise) and adds
  a delivery dependency.
- **A2 — TOTP (RFC 6238), authenticator-app.** Standard, offline, no third party.
  A 20-byte base32 secret, SHA-1 HOTP, 6 digits, 30s step, ±1 step drift window.
  Ten single-use recovery codes, stored as HMAC-SHA256 hashes and consumed by
  removal from the array.
  - **Chosen.** All pure (`@trace/domain/access/totp`), fully unit-testable.

### Where MFA state lives / how it gates

- `user_mfa` is keyed on the **user**, not the org (a person has one
  authenticator across every workspace), and is **not RLS'd** — like `session`,
  it is part of establishing identity. `session.mfa_passed` (already in the
  schema) records whether _this_ session cleared the challenge.
- The `AuthGuard` computes `mfaRequired` (`enrolled || org.requireMfa`) and
  `mfaSatisfied` (`!required || session.mfa_passed`). A non-satisfied session is
  refused (`403 auth.mfa_required`) on every route except `@Public()` and a small
  `@MfaExempt()` allowlist — `/me`, `POST /auth/mfa`, and `/me/mfa/{,setup,confirm}` —
  so a user can bootstrap, see the requirement, enrol, and challenge, but do
  nothing else until verified. An org that flips on `requireMfa` forces every
  member through enrolment on their next request.
- API-key requests never do MFA (`mfaRequired: false`).

### Data export

- **B1 — Stream rows per table on demand.** Rejected: no integrity artefact, no
  point-in-time snapshot.
- **B2 — A job that assembles a canonical-JSON bundle** of every tenant section
  (24 sections: identity, supply chain, evidence, carbon, trust, compliance,
  audit, ops), content-addresses it (`exports/<org>/<sha256>/export.json`), and
  exposes only metadata + a short-lived signed URL — exactly the Phase-8 audit
  package pattern (`{ driver, putBytes }` injected so `@trace/db` never imports
  `@trace/storage`). Bundles carry a manifest (per-section counts, total,
  disclaimer) and expire after 7 days (`expireStaleExports` flips `ready →
expired` and drops the key).
  - **Chosen.** Runs **synchronously** in the API request for now (like audit
    packages); a queue for very large tenants is a follow-up.

### Retention

- **Targets are operational / derived data only.** `ai_job`, `webhook_delivery`,
  `quality_scan`, `audit_simulation_run`, `ask_query`, `integration_run`,
  `export_job` — never evidence, calculations, datapoints, emissions, or the
  audit log. Each target has a hard minimum age (`ai_job` 90d, most others 30d).
- A policy is `(target, ageDays, enabled)`, unique per `(org, target)`. A run is
  **`dry_run`** (count only) or **`apply`** (delete). `apply` is refused while
  the org is under `legalHold`.
- **Automatic deletion is not done.** The worker records a `dry_run` per enabled
  policy across every active org on an hourly-ish sweep, so admins can _see_ what
  would be purged; `apply` is always a deliberate click in Settings. This keeps a
  destructive, irreversible action behind a human.
- The sweep enumerates orgs from the repository-scoped `organization` table (not
  `retention_policy`, which is RLS'd) and opens `withOrgContext` per org.

### RLS boundary

- `export_job`, `retention_policy`, `retention_run` — tenant-owned → **RLS FORCE**.
- `user_mfa` — identity, keyed on the user → **not RLS'd** (like `session`).

## Decision

- **`@trace/domain/access`**: `totp.ts` (base32, HOTP/TOTP, `verifyTotp` with
  drift window, `otpauthUrl`, recovery-code gen + hash), `export-bundle.ts`
  (`EXPORT_SECTIONS`, `buildExportManifest`, `EXPORT_TTL_HOURS`), `retention.ts`
  (`RETENTION_TARGETS`, `validateRetentionPolicy`, `retentionCutoff`). Pure; 17
  unit tests.
- **`@trace/shared`**: permissions `security.manage` (MFA enforcement + retention
  — `organization_admin` only) and `data.export` (also granted to `auditor` and
  `finance`).
- **`@trace/db`**: `mfa.ts` (`beginMfaEnrollment` / `confirmMfaEnrollment` /
  `verifyMfaChallenge` / `disableMfa` / `resolveMfaRequirement` / `getMfaStatus`)
  and `governance.ts` (`runExport` + `listExportJobs` / `exportJobById` /
  `expireStaleExports`; `upsertRetentionPolicy` / `deleteRetentionPolicy` /
  `listRetentionPolicies` / `listRetentionRuns` / `runRetention` /
  `activeOrganizationIds`). New models `user_mfa` / `export_job` /
  `retention_policy` / `retention_run` + `organization.require_mfa` /
  `organization.legal_hold`; migrations `0025_governance` + `0026_governance_rls`.
- **`apps/api`**: `AuthGuard` MFA gate + `@MfaExempt()`; `POST /auth/mfa`
  (challenge); `MfaModule` (`GET /me/mfa`, `POST /me/mfa/{setup,confirm,disable}`);
  `ExportsModule` (`/exports`, `POST`, `/:id`, `/:id/download` — `data.export`);
  `GovernanceModule` (`/settings/security` GET/PUT and `/settings/retention`
  {targets, list, `PUT :target`, `DELETE :target`, `POST run`} — `security.manage`).
  `/me` and the verify response now carry MFA status.
- **`apps/worker`**: an hourly retention **dry-run** sweep over every active org.
- **`apps/web`**: an `/auth/mfa` challenge page (the `(app)` layout redirects a
  non-satisfied session there); Settings → **Security** (self-enrolment with
  setup key + otpauth URI, recovery codes shown once, disable; plus the org
  `requireMfa` / `legalHold` toggles and an adoption count); Settings →
  **Data & Retention** (create/download exports; per-target retention policy
  editor; dry-run / apply; run history).
- **Seed**: a full-tenant export bundle for the demo org, and retention policies
  for `ai_job` / `webhook_delivery` / `ask_query` with one recorded dry-run.

## Consequences

- A user who loses both their authenticator and their recovery codes is locked
  out; recovery requires an operator to clear `user_mfa` (a `platform.admin`
  tool is a follow-up).
- Turning on org-wide `requireMfa` forces every member through enrolment before
  they can do anything else — deliberate, and reversible.
- The export bundle is a point-in-time copy; it is not incremental and holds no
  file bytes (documents are referenced by id + hash, not embedded).
- Retention `apply` is irreversible and manual by design; the worker only ever
  produces dry-runs. Scheduled automatic enforcement, and a queue for large
  exports, are follow-ups.
- SSO / SCIM / audit-log streaming / monitoring / billing / usage limits remain
  open under Phase 13.
