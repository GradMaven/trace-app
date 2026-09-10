# ADR-018: SCIM 2.0 provisioning

- **Status:** Accepted
- **Date:** 2026-09-10
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13g

## Context

Phases 13e / 13f landed SSO (OIDC, then SAML). SCIM 2.0 is the other half of the
enterprise identity story: the IdP pushes **user and group lifecycle** to TRACE
(create / update / deprovision) instead of TRACE learning about people only when
they first sign in. Phase 13g implements the **SCIM service-provider** side.

TRACE is the SCIM *server*. Unlike SSO there is no live external system needed to
test it honestly — the tests drive TRACE's own endpoints. What is deferred to a
later phase is the real billing-provider integration (needs a payment provider).

## Options considered

### What a SCIM Group maps to

- **A1 — SCIM Group ⇒ a TRACE role directly** (match by name). Rejected: forces
  the IdP admin to know TRACE role keys, and couples the group's identity to a
  role's identity.
- **A2 — SCIM Group ⇒ a first-class `scim_group` record + a configurable
  `group_role_mapping`** (`{ "<displayName or externalId>": ["role_key", …] }`).
  Group membership drives role assignment through the mapping.
  - **Chosen.** Same shape as the SSO `groupRoles` mapping; the IdP names its
    groups however it likes.

### Role reconciliation — how much does SCIM own

- **B1 — SCIM fully owns the membership's roles.** Rejected: stomps roles an
  admin assigned by hand in the console.
- **B2 — SCIM manages only its *managed set*** — `defaultRoles` ∪ every role that
  appears in `group_role_mapping`. The reconciler adds / removes only those; any
  role outside the set is left untouched.
  - **Chosen.** Non-destructive, predictable, and still lets SCIM be
    authoritative for what it's configured to manage.

### Deprovisioning

- A SCIM user is the provisioning projection of a `membership`. `active:false`
  (via PATCH or PUT) **suspends** the membership and strips the managed roles;
  `active:true` re-activates it. A `DELETE` removes the `scim_user` row (so a
  later `GET` is 404, which Azure AD expects) and suspends the membership — the
  platform `user` and the (suspended) `membership` are kept, so a re-create
  re-links cleanly. TRACE never hard-deletes a membership from a SCIM call.

### Data model — separate from SSO

- Parallel `scim_config` / `scim_user` / `scim_group` (+ a `scim_group_member`
  join). `scim_config` holds `token_hash` (sha256 of the bearer token — shown
  once, like an API key) + the role mapping. One connection per organization
  (`organization_id` unique).

### RLS boundary

- `scim_config` (holds the token hash), `scim_user` and `scim_group` are tenant
  config / data → **RLS FORCE** on `current_org()`. A SCIM request resolves the
  org from the `:orgSlug` path segment, verifies the bearer token
  (`authenticateScim` — opens `withOrgContext` to read `scim_config`), then every
  CRUD op runs inside `withOrgContext`. `scim_group_member` is a pure join with
  no `organization_id` (like `membership_role`) — **not RLS'd**; every read path
  reaches it through the RLS'd `scim_group` / `scim_user` parents.

### API surface

- **Bearer, not session.** SCIM routes are `@Public()` (so the global `AuthGuard`
  / `CsrfGuard` / MFA gate no-op) + a controller-level `ScimAuthGuard` that does
  the bearer check. `AuthGuard`'s API-key path was tightened to engage **only**
  for `trk_`-prefixed tokens, so a `scim_…` bearer falls through instead of
  being rejected as a bad API key.
- **`application/scim+json`.** `main.ts` registers the JSON body parser for that
  media type too; a `ScimContentTypeInterceptor` stamps it on responses; a
  `ScimExceptionFilter` renders errors as the RFC 7644 `Error` object
  (`scimType` `uniqueness` / `invalidValue`) instead of the app-wide envelope.

## Decision

- **`@trace/domain/access/scim.ts`** (pure): token gen / constant-time compare,
  `parseScimUser` / `parseScimGroup`, `normalizeScimPatch` + `applyScimUserPatch`
  / `applyScimGroupPatch` (plain-model appliers — `add` / `remove` / `replace`,
  `path` incl. `name.givenName` and the `members[value eq "id"]` selector),
  `scimUserResource` / `scimGroupResource` / `scimListResponse` / `scimError`,
  `parseScimFilter` (`attr eq "value"` only), `scimPaginationParams` (clamp
  `count` ≤ 200), `resolveScimRoleKeys` + `scimManagedRoleKeys`, and the
  ServiceProviderConfig / ResourceTypes / Schemas documents. 14 unit tests.
- **`@trace/db/scim.ts`**: `upsertScimConfig` / `getScimConfig` / `rotateScimToken`
  / `deleteScimConfig`, `authenticateScim(prisma, { orgSlug, bearerToken })`,
  `scim{List,Get,Create,Replace,Patch,Delete}User`,
  `scim{List,Get,Create,Replace,Patch,Delete}Group`, `scimAdminOverview`, and an
  internal `reconcileMemberRoles` (managed-set diff). Every mutation writes an
  audit entry (`scim.user_provisioned` / `_updated` / `_reactivated` /
  `_deprovisioned`, `scim.group_created` / `_updated` / `_deleted`,
  `scim.config_*`, `scim.token_rotated`). New models `scim_config` / `scim_user`
  / `scim_group` / `scim_group_member`; migrations `0035_scim` + `0036_scim_rls`
  (RLS FORCE on the first three).
- **`apps/api`**: `ScimModule` — `ScimUsersController` / `ScimGroupsController` /
  `ScimDiscoveryController` under `/scim/v2/:orgSlug` (`@Public()`, `ScimAuthGuard`,
  `ScimExceptionFilter`, `ScimContentTypeInterceptor`) and `ScimConfigController`
  (`GET` / `PUT` / `POST /token` / `DELETE /settings/scim` — `security.manage`).
  `AuthGuard` API-key tightening + `main.ts` body-parser media type.
- **`apps/web`**: Settings → **SCIM Provisioning** — the base URL + token
  (issue / rotate, shown once), the enable toggle, the default-roles chips and
  the group → roles JSON map, plus a read-only list of provisioned users (with
  their resolved roles) and groups.
- **Seed**: a **disabled** demo SCIM connection for the demo org with a token
  issued (so the console shows a prefix) and a representative group mapping.

## Consequences

- No new permission — SCIM config reuses `security.manage`; the protocol
  endpoints authenticate with the bearer token only.
- The canonical identity stays `user.email`. A SCIM `emails` PATCH is stored in
  `scim_user.raw` for round-trip fidelity but does not rename the platform user
  (other memberships depend on that key).
- Filtering is `eq`-only; `startIndex` / `count` pagination, no sort, no bulk, no
  ETag — all advertised as unsupported in the ServiceProviderConfig, which the
  major IdPs tolerate.
- A real billing-provider integration is the only remaining Phase-13 item.
