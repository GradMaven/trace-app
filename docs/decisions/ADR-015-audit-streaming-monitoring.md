# ADR-015: Audit-log streaming + Prometheus metrics + health

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 13d

## Context

The last offline-buildable slice of Phase 13: **push every matching audit entry
to a per-organization SIEM stream**, plus **operational monitoring** (a
Prometheus `/metrics` endpoint, a detailed health report, per-org ops stats).
SSO / SCIM and a real billing-provider integration stay deferred — SSO/SCIM need
a live IdP, and payment wiring is its own phase.

Constraints unchanged: RLS on tenant tables; the audit log stays append-only and
hash-chained; no fabricated metrics.

## Options considered

### How audit entries reach a SIEM

- **A1 — Reuse the Phase-13a webhook fan-out.** Rejected: webhooks are a curated
  ~14-event subset; a SIEM wants **everything**, and a fan-out row per audit
  entry per stream is far too many rows.
- **A2 — Cursor-tail `audit_log` per stream.** Each `audit_stream` stores a
  `cursor` (last audit-log id considered). The worker, per active org, reads the
  next window after the cursor, filters by the stream's `{ actionPrefixes,
resourceTypes }`, and POSTs a **signed batch** (same `t=,v1=` HMAC as
  webhooks). On success the cursor advances — even when nothing matched, so quiet
  periods still make progress; a stream starts at the current log head (no
  back-fill).
  - **Chosen.** One integration point, bounded batch size, and the log stays the
    single source of truth.

### Retry / failure

- The `audit_stream_delivery` row owns the retry (like `webhook_delivery`):
  capped exponential backoff (0 / 15s / 1m / 5m / 15m / 1h / 3h / 6h), `dead`
  after 8 attempts. A `dead` delivery would wedge the stream forever, so the
  cursor is advanced past it and `last_error` recorded. A stream that fails
  **20** times in a row is auto-`paused`.

### Where the sweep runs / RLS

- `audit_stream` is tenant config → **RLS FORCE**. The worker enumerates active
  orgs from `organization` (repository-scoped) and opens `withOrgContext` per org
  — the retention-sweep pattern. `audit_stream_delivery` is a system-written
  operational log → **not RLS'd** (like `webhook_delivery`), carrying
  `organization_id`; every read path filters on it.

### `/metrics`

- **Prometheus text exposition format 0.0.4**, rendered by a pure serialiser in
  `@trace/domain` (`renderPrometheus`). Process-wide, single endpoint —
  `@Public()`, gated by a `METRICS_TOKEN` bearer when the env var is set (open in
  dev). It only counts tables reachable without an org context (`organization`,
  `user`, `audit_log`, `webhook_delivery`, `audit_stream_delivery`,
  `subscription`) plus the worker heartbeat; per-tenant depth is `GET /ops/stats`.

### Health & heartbeat

- A `component_heartbeat` table (global, keyed on `component`); the worker
  upserts `worker` every 30 s. `GET /health/detailed` (`@Public()`) reports a
  DB round-trip check, the worker-heartbeat age (`up` < 2 min, `degraded` < 10
  min, else `down`), and the storage driver, rolled up to
  `healthy` / `degraded` / `unhealthy` by a pure helper. The existing `GET
/health` and `/health/ready` probes are untouched.

## Decision

- **`@trace/domain/access`**: `audit-stream.ts` (`AuditStreamFilter`,
  `normalizeAuditStreamFilter` — regex-guards prefixes/resource types,
  `matchesAuditStream`, `buildAuditStreamBatch`, `auditStreamNextAttemptAt`,
  the batch-size / max-attempts / auto-pause constants), `prometheus.ts`
  (`renderPrometheus`, `PROMETHEUS_CONTENT_TYPE`), `health.ts` (`rollUpHealth`,
  `buildHealthReport`, `heartbeatStatus`). Pure; 14 unit tests.
- **`@trace/shared`**: permissions `audit_stream.manage`
  (`organization_admin`) and `ops.read` (also `sustainability_manager`,
  `finance`, `auditor`).
- **`@trace/config`**: `METRICS_TOKEN` (default `''`).
- **`@trace/db`**: `audit-stream.ts` (`createAuditStream` /
  `updateAuditStream` / `deleteAuditStream` / `rotateAuditStreamSecret` /
  `listAuditStreams` / `listAuditStreamDeliveries` / `sendTestAuditStream`;
  `dispatchOrgAuditStreams` — the per-org sweep body; `writeHeartbeat` /
  `readHeartbeat`) and `ops.ts` (`orgStats`, `platformMetrics`). New models
  `audit_stream` / `audit_stream_delivery` / `component_heartbeat`; migrations
  `0029_audit_stream` + `0030_audit_stream_rls` (RLS FORCE on `audit_stream`
  only).
- **`apps/api`**: `AuditStreamsModule` (`/settings/audit-streams` CRUD +
  `/:id/{rotate-secret,test}` + `/deliveries` — `audit_stream.manage`);
  `OpsModule` (`GET /ops/stats` — `ops.read`; `GET /metrics` — `@Public()`,
  token-gated, `text/plain`); `GET /health/detailed` added to the health
  controller.
- **`apps/worker`**: a 20 s audit-stream dispatch sweep and a 30 s worker
  heartbeat.
- **`apps/web`**: Settings → **Audit Streams** (create with an action-prefix
  filter, one-time secret, test / pause / delete, delivery log) and **Ops &
  Health** (org stat cards + worker-heartbeat status).
- **Seed**: a demo audit stream filtered to `compliance.` / `audit.` /
  `evidence.` / `security.`, and a primed worker heartbeat.

## Consequences

- A stream only ever forwards entries recorded **after** it was created; a SIEM
  wanting history uses `GET /audit-log/export` (Phase 13c).
- The cursor advances past a permanently-failing (`dead`) batch so one broken
  endpoint can't halt a stream indefinitely — those entries are lost to that
  SIEM (recorded in `last_error`); re-send them via the export.
- `/metrics` is unauthenticated when `METRICS_TOKEN` is unset — safe for a
  private network / dev, must be set in production.
- Per-org sweep means the dispatcher does one `withOrgContext` per active org
  every 20 s; fine at this scale, a documented follow-up at thousands of orgs.
- SSO / SCIM and a payment integration remain the only open Phase-13 items.
