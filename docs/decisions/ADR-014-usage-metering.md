# ADR-014: Usage metering, plan quotas & audit-log egress

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13c

## Context

Phase 13c is the metering slice of "enterprise readiness": **per-organization
usage counters, plan quotas with hard enforcement, and an enterprise audit-log
egress API**. SSO / SCIM stay deferred (they need a real IdP to test honestly).
There is deliberately **no payment integration** — a plan is assigned by an
operator / admin; TRACE meters and enforces, it does not bill.

Constraints unchanged: RLS on tenant tables; append-only hash-chained audit log;
no fabricated metrics — every counter is a real increment on a real request.

## Options considered

### How usage is counted

- **A1 — A row per event.** Rejected for `api_request`: a write per request is a
  latency + contention cost on the hot path.
- **A2 — A period-bucketed counter** (`usage_counter`, unique on
  `(org, period, metric)`, `period = YYYY-MM` UTC), upserted with
  `value += quantity`. For the low-frequency metrics (`ai_job`,
  `calculation_run`, `export_job`) an additional `usage_event` row is written for
  drill-down; `api_request` is counter-only. `seats` is a **live gauge** derived
  from `membership`, never incremented.
  - **Chosen.** One upsert on the hot path; the counter is the source of truth.

### Where the increment happens

- A global **`UsageInterceptor`** records `api_request` for every authenticated
  request with an active org on a 2xx, and the `@Metered(metric)` increment for
  decorated routes — all **fire-and-forget**, never blocking or failing the
  response. Metering lives entirely in the API layer; the orchestrators are
  untouched.

### Enforcement

- A **`QuotaGuard`** (after `PermissionsGuard`) blocks `@Metered(metric)` routes
  whose metric is in `ENFORCED_METRICS` (`ai_job`, `calculation_run`,
  `export_job`) with **`429 quota.exceeded`** when the org is at or over its
  monthly quota. `api_request` and `seats` are metered for visibility but never
  block a request.
- A plan (`@trace/domain PLAN_TIERS`, loaded into the `plan` table) sets a
  monthly quota per metric; a metric absent from the map is unlimited
  (`enterprise` has none). A `softWarnPct` warns without blocking; when a
  `recordUsage` write **crosses** that threshold it emits a
  `usage.threshold_reached` audit entry, which fans out to webhooks through the
  existing Phase-13a `writeAuditLog` hook (new webhook event
  `usage.threshold_reached`).

### Plans as data

- `plan` is a **global catalogue table** (repository-scoped, like the
  emission-factor library), upserted from `PLAN_TIERS` by `loadPlans` in
  `provisionOrganization`. `subscription` is one RLS'd row per org
  (`organizationId` PK) holding `planKey` + a `currentPeriod` cursor the worker
  rolls forward at the month boundary. No payment fields.

### Audit-log egress

- The existing `GET /audit-log` gains **filters** (action prefix, actor,
  resource type, date range — each shape-validated in `@trace/domain` so a
  filter can never be an injection vector) on top of its cursor paging.
- **`GET /audit-log/export`** streams the filtered log as **newline-delimited
  JSON** (oldest-first, so the file is chain-verifiable), `Content-Type:
application/x-ndjson`, capped at `AUDIT_EXPORT_MAX_ROWS` (20 000) with an
  `x-trace-truncated` header past that. Permission `auditlog.read` (unchanged).

### RLS boundary

- `subscription`, `usage_counter`, `usage_event` — tenant-owned → **RLS FORCE**.
  The `UsageInterceptor` and the worker roll-forward open `withOrgContext` (the
  worker enumerates orgs via `activeOrganizationIds`, like the retention sweep).
- `plan` — global catalogue → not RLS'd.
- `usage_event` is added to the Phase-13b retention target list (min 30 days).

## Decision

- **`@trace/domain/access`**: `metering.ts` — `USAGE_METRICS` (5),
  `ENFORCED_METRICS`, `PLAN_TIERS` (free / growth / enterprise),
  `billingPeriodKey` / `billingPeriodBounds`, `evaluateUsage` /
  `evaluateMetric` (`ok` / `warn` / `over`), `wouldExceedQuota`,
  `crossedSoftWarn`. `audit-egress.ts` — `normalizeAuditFilter` (shape-guards
  the filter), `toNdjson`, `AUDIT_EXPORT_MAX_ROWS`. Pure; 13 unit tests.
- **`@trace/shared`**: permissions `usage.read` (+ `sustainability_manager`,
  `finance`) and `billing.manage` (`organization_admin`).
- **`@trace/db`**: `metering.ts` (`loadPlans`, `ensureSubscription` —
  get-or-create + roll `currentPeriod`, `setPlan` — audit `billing.plan_changed`,
  `recordUsage` — counter upsert + event + soft-warn audit, `recordApiRequest` —
  raw hot-path helper, `currentUsage`, `checkQuota`). `audit.ts` gains
  `queryAuditLog` (filtered + cursor) and `exportAuditLog` (NDJSON, capped). New
  models `plan` / `subscription` / `usage_counter` / `usage_event`; migrations
  `0027_metering` + `0028_metering_rls`. `provisionOrganization` now calls
  `loadPlans` + `ensureSubscription`.
- **`apps/api`**: `@Metered()` decorator; global `UsageInterceptor` +
  `QuotaGuard`; `@Metered('ai_job' | 'calculation_run' | 'export_job')` on the
  three expensive routes. `UsageModule` — `GET /usage`, `GET /usage/plans`,
  `PUT /usage/plan` (`billing.manage`). `AuditLogController` — filters on `GET
/audit-log` and a new `GET /audit-log/export` (NDJSON).
- **`apps/worker`**: a 6-hour `ensureSubscription` roll-forward over every active
  org (a no-op mid-month).
- **`apps/web`**: Settings → **Usage & Plan** (per-metric bars vs quota, plan
  cards with a switch action) and, on the Activity Log, an action-prefix filter
  - an NDJSON export button.
- **Seed**: the demo org is put on the `growth` plan with a populated
  current-period counter set.

## Consequences

- `api_request` metering adds one indexed upsert per authenticated request,
  fire-and-forget. Production would batch this in memory; that is an
  optimisation, not a correctness change.
- Quota enforcement is monthly and per-metric; hitting it returns `429` with a
  message pointing at the plan. There is no grace / overage — by design for now.
- The audit-log export is bounded at 20 000 rows; larger ranges need date
  windowing (documented in the response headers). A true streamed export is a
  follow-up.
- Plans carry no price and no payment state; wiring a billing provider is out of
  scope and would be its own phase.
- SSO / SCIM / audit-log _streaming_ (vs. pull) / advanced monitoring remain
  open under Phase 13.
