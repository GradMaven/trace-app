# ADR-012: Enterprise access — API keys, outbound webhooks, custom roles

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13

## Context

Roadmap Phase 13 ("Enterprise readiness") bundles SSO, MFA, SCIM, audit-log
streaming, advanced RBAC, export, retention, billing, usage limits, API keys and
webhooks. That is several phases of unrelated work. This iteration takes the
slice that is buildable and testable **offline** and that unblocks integration
without a third-party IdP: **programmatic access (API keys), event fan-out
(outbound webhooks), and tenant-defined roles**. SSO / MFA / SCIM are deferred to
a later iteration where a real IdP is available (a stubbed SAML flow would
violate "no fake" — Principle: no fabricated compliance/security claims).

Constraints carried from the brief: enterprise security day one; RLS tenant
isolation on every tenant table; auditability first-class (append-only,
hash-chained); human approval gates for consequential AI — none of this changes,
and API keys must not become a hole in any of it.

## Options considered

### How an API key authenticates

- **A1 — A key _is_ a user (service account with a membership).** Rejected: it
  drags in the whole membership/role model, and a deactivated creator would
  orphan the key.
- **A2 — A key is a first-class credential, like a session.** `trk_<keyId>_<secret>`;
  only `token_prefix` (public, unique, greppable) + `sha256(secret)` are stored;
  the full token is shown once. The AuthGuard resolves it — no cookie, no CSRF —
  to exactly one organization and a **scoped, capped** permission set. The
  responsible human is the key's creator, recorded on every audit entry the key
  writes.
  - **Chosen.** It mirrors `session` (the other credential that _establishes_ org
    context and is therefore itself un-RLS'd, looked up globally by hash).

### What a key is allowed to do

- Scopes are **coarse tokens** (`read:all`, `activity:write`, …), not raw
  permission keys — stable, safe to print, expanded to a concrete permission set
  per request. Two invariants enforced in `@trace/domain` so no caller can
  bypass them: (1) the effective set is always a subset of the catalog; (2) a key
  can **never** hold a self-propagating / access-control permission —
  `apikey.manage`, `webhook.manage`, `role.manage`, `member.*`,
  `organization.update`, `platform.admin`. A leaked key cannot escalate or
  persist itself.

### How webhooks decide what to send

- **B1 — Instrument every orchestrator with an `emit()` call.** Rejected:
  dozens of call sites, easy to miss one, and it re-describes what the audit log
  already records.
- **B2 — Webhooks mirror the audit stream.** `writeAuditLog` already runs for
  every consequential mutation. A pure map (`webhookEventForAuditAction`) turns
  ~13 audit actions into webhook events; when one fires and the tenant has active
  endpoints subscribed, `writeAuditLog` queues a `webhook_delivery` **in the same
  transaction** — so a delivery is never queued for a change that rolls back.
  Actions that are not events cost only the pure lookup.
  - **Chosen.** One integration point, transactionally consistent, and the event
    set is a deliberate curated subset (not "every audit action").

### Delivering them

- **C1 — A BullMQ queue.** Rejected as the _source of truth_: a Redis outage
  would drop events. The delivery rows are the queue.
- **C2 — A DB-backed sweep.** `dispatchDueWebhookDeliveries(prisma, { fetch })`
  is one pure-ish pass: sign (`t=<ts>,v1=<hmac>` over `timestamp.body`), POST,
  record the response, reschedule with capped exponential backoff
  (0 / 30s / 2m / 10m / 30m / 2h), mark `dead` after 6 attempts, auto-`disable`
  an endpoint after 15 consecutive failures. The worker calls it on a 15s
  interval; `fetch` is injected so the seed and the CI test drive it with a stub.
  - **Chosen.**

### RLS boundary

- `webhook_endpoint` — tenant-configured → **RLS FORCE**, like every tenant
  table; only ever touched inside `withOrgContext`.
- `api_key` — the credential that _establishes_ org context → **not RLS'd**
  (repository-scoped, like `session` / `magic_link_token`); looked up globally by
  `hashed_secret`; every CRUD path filters `organization_id` explicitly.
- `webhook_delivery` — a system-written operational log swept cross-tenant by the
  dispatcher → **not RLS'd** (like `audit_log`); carries `organization_id`, and
  every read path filters on it.

### Custom roles

- The `role` table already supports per-org rows with an arbitrary `key`. Phase
  13 adds `role.is_system` (true for the 8 shipped roles — set in provisioning,
  backfilled by migration), a pure `validateCustomRole` (slug key distinct from
  the built-ins, permissions ⊆ catalog, never `platform.admin`), CRUD on
  `role.manage` that refuses to touch a system role or delete a role a member
  still holds, and `PUT /members/:userId/roles` (accepts built-in _or_ custom
  keys, with a last-Organization-Admin guard against lockout).

## Decision

- **`@trace/domain/access`**: `api-key.ts` (`generateApiKey` / `parseApiKey` /
  `hashApiKeySecret` / constant-time `apiKeySecretMatches` / `apiKeyState`),
  `scopes.ts` (`API_KEY_SCOPES`, `expandApiKeyScopes`,
  `API_KEY_FORBIDDEN_PERMISSIONS`), `webhook.ts` (event catalog,
  `webhookEventForAuditAction`, `signWebhookBody` / `verifyWebhookSignature`,
  backoff schedule, `buildWebhookEventPayload`), `role.ts` (`validateCustomRole`).
  Pure; 24 unit tests.
- **`@trace/shared`**: permissions `apikey.manage`, `webhook.manage` (held by
  `organization_admin` / `platform_admin` only).
- **`@trace/db/access.ts`**: `createApiKey` / `revokeApiKey` / `listApiKeys` /
  `authenticateApiKey`; `createWebhookEndpoint` / `updateWebhookEndpoint` /
  `deleteWebhookEndpoint` / `rollWebhookSecret` / `listWebhookEndpoints`;
  `listWebhookDeliveries` / `webhookDeliveryById` / `retryWebhookDelivery` /
  `sendTestWebhook`; `dispatchDueWebhookDeliveries`. `writeAuditLog` gains the
  transactional fan-out. Models `api_key` / `webhook_endpoint` /
  `webhook_delivery` + `role.is_system`; migrations `0023_access` +
  `0024_access_rls`.
- **`apps/api`**: `AuthGuard` gains the `x-api-key` / `Bearer` path (actor carries
  `viaApiKeyId`; `CsrfGuard` skips those requests). `ApiKeysModule`
  (`/api-keys`, `/api-keys/scopes`, `POST`, `POST /:id/revoke` — all
  `apikey.manage`). `WebhooksModule` (`/webhooks` CRUD + `/events` +
  `/:id/roll-secret` + `/:id/test` + `/deliveries(/:id)` + `/deliveries/:id/retry`
  — all `webhook.manage`). `RolesController` gains `POST` / `PATCH /:id` /
  `DELETE /:id` (`role.manage`); `MembersController` gains
  `PUT /:userId/roles` (`role.manage`).
- **`apps/worker`**: a 15s interval runs `dispatchDueWebhookDeliveries` with a
  10s-timeout `fetch`, `redirect: 'manual'`.
- **`apps/web`**: Settings → API Keys (create with scope checkboxes, one-time
  token reveal, revoke), Webhooks (add endpoint, one-time secret reveal, test /
  pause / delete) + Webhook deliveries (payload inspector, retry), and Roles
  (custom-role editor grouped by permission prefix); Members gains an inline
  role editor.
- **Seed**: a read-only demo API key (printed once), a webhook endpoint
  subscribed to the events the later trust / compliance / audit seed steps emit
  (so real signed deliveries are queued), and a `data_steward` custom role
  assigned to the analyst.

## Consequences

- API-key requests appear in the audit log as the key's creator with
  `resourceType`/`action` unchanged; the `viaApiKeyId` on the request context is
  available for finer attribution later.
- Webhook deliveries seeded before a worker with network access exists stay
  `pending` — that is correct (nothing was delivered), and the delivery log shows
  the signed payloads that will be sent.
- The fan-out adds one pure function call to every `writeAuditLog`, and one
  indexed `webhook_endpoint` query only when a webhook-relevant action fires.
- `api_key` / `webhook_delivery` isolation rests on explicit `organization_id`
  filters rather than RLS, consistent with `session` / `audit_log`; the
  integration test asserts a second tenant sees none of either.
- SSO / MFA / SCIM / audit-log streaming / export / retention / billing / usage
  limits remain open under Phase 13 and will be scoped in a later iteration.
