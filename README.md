# TRACE

**Sustainability Evidence & Supply-Chain Intelligence Platform**

> European companies don't have an ESG *reporting* problem. They have an ESG *evidence*
> problem.

TRACE turns fragmented supplier, operational, procurement, logistics and environmental
information into a continuously **traceable evidence system** that supports carbon
accounting, Scope 3 measurement, supplier collaboration, ESG reporting, regulatory mapping
and audit readiness.

Every material sustainability number in TRACE is explainable — back to the supplier, the
document, the activity data, the emission factor, the methodology, the reviewer and the
regulatory disclosure it supports.

**Every ESG number. Proven.**

---

## What this is / is not

| TRACE is | TRACE is not |
| --- | --- |
| Enterprise sustainability **evidence infrastructure** | A generic ESG dashboard |
| A data-lineage and provenance system | A CSRD report generator |
| A deterministic, reproducible carbon engine | A chatbot wrapped around an emissions calculator |
| Human-reviewed AI extraction | Auto-verified AI output |

## Project status

**Phase 13b — Enterprise identity & governance (landed).** On top of Phase 13a: account
security and data governance. **`@trace/domain/access`** gains (pure) `totp.ts` (base32 +
RFC-6238 TOTP + a drift-tolerant verifier + `otpauth://` URI + single-use recovery codes),
`export-bundle.ts` (a 24-section export catalogue + manifest builder + 7-day TTL), and
`retention.ts` (retention targets — **operational / derived data only**, never evidence,
calculations, datapoints or the audit log — plus policy validation). `@trace/db` adds
`mfa.ts` (enrol → confirm → one-time recovery codes; challenge with a TOTP or a consumed
recovery code; disable; `resolveMfaRequirement` for the guard) and `governance.ts`
(`runExport` — reads every tenant section into a canonical-JSON bundle, SHA-256, uploads it
content-addressed, 7-day expiry; `runRetention` — `dry_run` counts, `apply` deletes, refused
while the org is under legal hold). New `user_mfa` (user-keyed, not RLS'd like `session`),
`export_job`, `retention_policy`, `retention_run` tables and `organization.require_mfa` /
`legal_hold`. The API `AuthGuard` gains an MFA gate (`403 auth.mfa_required` on every route
outside a small `@MfaExempt()` allowlist) with `POST /auth/mfa`, plus `/me/mfa/*`,
`/exports/*` (`data.export`, also held by auditor + finance), and `/settings/{security,
retention}/*` (`security.manage`). The worker runs an hourly retention **dry-run** sweep — it
never deletes on its own. Web adds an `/auth/mfa` challenge page (the app layout redirects an
unverified session there) and Settings → Security and Data & Retention. Builds, typechecks,
lints and unit tests are green; the Postgres-dependent integration suites (…, access,
governance) run in CI. SSO, SCIM, audit-log streaming and billing remain open under
Phase 13 — see [docs/roadmap.md](docs/roadmap.md).

**Phase 13a — Enterprise access (landed).** On top of Phases 1–12: programmatic access and
event fan-out. **New `@trace/domain/access`** (pure) — API-key format + SHA-256 hashing +
constant-time compare; coarse **scopes** (`read:all`, `activity:write`, …) that expand to a
permission set and can never include an admin or self-propagating permission; a webhook
**event catalog**, an audit-action → event map, HMAC `t=,v1=` signing, and a capped
exponential backoff schedule; `validateCustomRole`. `@trace/db` adds `access.ts`
(`createApiKey` / `authenticateApiKey` / …, webhook endpoint CRUD, and
`dispatchDueWebhookDeliveries(prisma, { fetch })` — sign, POST, record, reschedule, `dead`
after six tries, auto-disable an endpoint after fifteen straight failures) and, crucially,
`writeAuditLog` now **fans out**: a webhook-mapped mutation queues one `webhook_delivery`
per subscribed endpoint _in the same transaction_, so a delivery is never queued for a
change that rolls back. New `api_key` / `webhook_endpoint` / `webhook_delivery` tables and a
`role.is_system` flag; the API `AuthGuard` gains an `x-api-key` / `Bearer` path (CSRF-exempt,
capped permissions), plus `/api-keys` and `/webhooks` modules, custom-role CRUD, and
`PUT /members/:id/roles`. The worker dispatches due deliveries every 15s. Web adds Settings →
API Keys, Webhooks (with a delivery inspector), a custom-role editor, and an inline member
role editor. Builds, typechecks, lints and unit tests are green; the Postgres-dependent
integration suites (RLS / tenant isolation, supplier, evidence, carbon, AI extraction, trust,
compliance, audit, command center, ask, procurement, integrations, access) run in CI. SSO,
MFA, SCIM, export, retention and billing remain open under Phase 13 — see
[docs/roadmap.md](docs/roadmap.md).

**Phase 12 — Enterprise integrations (landed).** On top of Phases 1–11: bulk activity data
in, with per-row validation before anything is written. **New `@trace/domain/integrations`**
(pure) — a dependency-free CSV/TSV parser (`parseDelimited`), an `IntegrationAdapter`
contract, and `CsvActivityAdapter` (`csv_activity`) that maps a spreadsheet's columns onto
the TRACE activity-data shape and validates every row (missing required, non-numeric/negative
quantity, bad enum, bad date, unknown unit, non-UUID subject/supplier id). `@trace/db`
adds `previewImport` (pure — every row with its raw values, typed result or `null`, and
errors, plus a valid/invalid summary) and `commitImport` (writes **only** the valid rows as
`activity_data`, each stamped `source_ref = import:<run>:<line>` and defaulting to
`estimated` provenance, one audit entry per run), plus saved connectors and run history in
new `integration` / `integration_run` tables (RLS-forced). API exposes
`/integrations/*` behind a new `integration.manage` permission with a 5 MB text-only upload
guard; web adds Settings → Integrations and an import wizard (upload → auto-map → preview →
import — nothing is written until you confirm). Builds, typechecks, lints and unit tests are
green; the Postgres-dependent integration suites (RLS / tenant isolation, supplier, evidence,
carbon, AI extraction, trust, compliance, audit, command center, ask, procurement,
integrations) run in CI. See [docs/roadmap.md](docs/roadmap.md) for exact status and what's
next (Phase 13 — Enterprise readiness).

**Phase 11 — Procurement intelligence (landed).** On top of Phases 1–10:
`@trace/domain/procurement` — `compareSuppliers` (pure) ranks the supply base by **carbon
intensity** (tCO2e per €1,000 of annual spend), shows an `attributionQuality` per supplier
(spend-based EEIO screen, refined where supplier-specific calculations exist), and proposes
**deterministic**, quantified reduction opportunities; `projectScenario` (pure) re-runs the
Phase-4 carbon engine on a set of supplier lines with per-line changes (cut volume, switch
to a cleaner factor, drop a supplier) and reports baseline → projected → delta. `@trace/db`
gathers the tenant's suppliers + spend + attributed emissions + Trust + passports, and
persists **immutable** `procurement_scenario` snapshots (audit-logged). Web adds Supply
Chain → **Carbon Map** and a **Procurement Scenarios** builder. Builds, typechecks, lints
and unit tests are green; the Postgres-dependent integration suites (RLS / tenant isolation,
supplier, evidence, carbon, AI extraction, trust, compliance, audit, command center, ask,
procurement) run in CI. See [docs/roadmap.md](docs/roadmap.md) for exact status and what's
next (Phase 12 — Enterprise integrations).

**Phase 10 — Ask TRACE (landed).** On top of Phases 1–9: natural-language questions
answered by **retrieval over the tenant's own records** — the model never writes a query and
never answers a factual question about the workspace from outside knowledge. `@trace/ai`
gains the `nl_analytics` capability (two narrow, versioned calls: map the question to one of
11 fixed intents, then compose an answer **grounded only in a set of numbered records** and
say which it cited). `@trace/db` holds a catalog of hand-written, tenant-scoped retrievals
(emissions summary/trend, top Scope 3 categories, top suppliers, missing evidence, estimated
datapoints, outdated factors, low-Trust datapoints, compliance gaps, open findings,
data-quality issues); `runAskQuery` records **both model calls as `ai_job` rows** before
their output is used, and when retrieval returns nothing (or the intent is `unsupported`)
the answer says so and no second call is made. Every answer is stored as an `ask_query` row
with its citations (each a clickable UI link). Web adds `/ask` — a question box with example
prompts and answers that link to their sources. Builds, typechecks, lints and unit tests
are green; the Postgres-dependent integration suites (RLS / tenant isolation, supplier,
evidence, carbon, AI extraction, trust, compliance, audit, command center, ask) run in CI.
See [docs/roadmap.md](docs/roadmap.md) for exact status and what's next (Phase 11 —
Procurement intelligence).

**Phase 9 — Command Center (landed).** On top of Phases 1–8: one read-only aggregate,
`commandCenterOverview`, composes what the earlier phases already produce — the GHG
inventory and a multi-period trend, the data-provenance mix (and the primary-data share),
the Trust distribution, audit readiness and open findings, compliance progress and the top
gaps, supplier coverage, and recent activity — into a single payload behind
`GET /command-center/overview`. **Nothing is estimated for display**: every figure is read
straight from a model row or an existing engine, no writes, no new domain package. The
Command Center page is rebuilt on that endpoint with band-coloured gauges, an inline-SVG
emissions-trend sparkline, provenance and Trust stack-bars, and navigable lists of the top
compliance gaps and audit findings. Builds, typechecks, lints and unit tests are green; the
Postgres-dependent integration suites (RLS / tenant isolation, supplier, evidence, carbon,
AI extraction, trust, compliance, audit, command center) run in CI. See
[docs/roadmap.md](docs/roadmap.md) for exact status and what's next (Phase 10 — Ask TRACE).

**Phase 8 — Audit workspace (landed).** On top of Phases 1–7: `@trace/domain/audit` — a
documented additive **audit-readiness score** (`audit-readiness@1.0.0`, 0–100) over evidence
verification, calculation reproducibility and approval, data quality, Trust level,
compliance mapping and audit-trail integrity, with a per-dimension breakdown and itemised
issues that each point at their object. `@trace/db` adds `audit` engagements,
`audit_finding` (idempotent re-runs, auto-resolve, sticky *accepted risk* / *dismissed*),
`audit_simulation_run` and `audit_package` (RLS on all four). `runAuditSimulation` composes
`reproduceCalculation`, `verifyAuditChain`, the data-quality issues, Trust Scores and the
compliance mappings; `generateAuditPackage` assembles a canonical-JSON bundle — evidence +
verifications, calculations + steps + a live reproduce check, datapoints + lineage + Trust,
compliance mappings + gaps, open findings, and the audit-log chain verification — written
to object storage and content-addressed by its SHA-256. Web adds Audit → Readiness,
Findings, Evidence Review with a per-datapoint **evidence-chain walk** (disclosure →
datapoint → calculation → activity → factor → evidence), Controls, and Audit Package
(generate + download). Builds, typechecks, lints and unit tests are green; the
Postgres-dependent integration suites (RLS / tenant isolation, supplier, evidence, carbon,
AI extraction, trust, compliance, audit) run in CI. See [docs/roadmap.md](docs/roadmap.md)
for exact status and what's next (Phase 9 — Command Center).

*(Phase-by-phase notes for Phases 1–7 have been trimmed — see
[docs/roadmap.md](docs/roadmap.md) for the full per-phase status. In brief: **1** monorepo +
auth + RBAC + tenancy + hash-chained audit log; **2** supplier directory, portal and
versioned Supplier Passport; **3** evidence infrastructure — storage, the Evidence lifecycle
state machine, Datapoints; **4** the deterministic, reproducible carbon engine; **5** the
`@trace/ai` package — Claude adapter + dev stub, a human-gated document-extraction pipeline;
**6** the Trust Engine — Trust Score, data-quality checks, anomaly detection; **7** the
`@trace/compliance` package — a versioned ESRS rule store and a generic mapping engine that
never says "compliant".)*

Reference documents:

- [`TRACE-INITIAL-ENGINEERING-ASSESSMENT.md`](./TRACE-INITIAL-ENGINEERING-ASSESSMENT.md) —
  current state, stack, architecture, roadmap, next steps.
- [`docs/`](./docs) — product vision, architecture, domain model, data model, API,
  security, AI architecture, compliance architecture, design system, roadmap.
- [`docs/decisions/`](./docs/decisions) — Architecture Decision Records.

## Documentation map

| Document | Purpose |
| --- | --- |
| [docs/product-vision.md](docs/product-vision.md) | Thesis, principles, personas, modules, north star. |
| [docs/architecture.md](docs/architecture.md) | Layers, monorepo, module boundaries, cross-cutting concerns. |
| [docs/domain-model.md](docs/domain-model.md) | Aggregates, entities, the lineage spine, state machines. |
| [docs/data-model.md](docs/data-model.md) | Tables, keys, indexes, versioning, RLS, provenance. |
| [docs/api.md](docs/api.md) | REST conventions, versioning, resources, errors, OpenAPI. |
| [docs/security.md](docs/security.md) | Threat model, controls, tenant isolation, GDPR-ready data lifecycle. |
| [docs/ai-architecture.md](docs/ai-architecture.md) | Capabilities, provider abstraction, human-in-the-loop, AIJob record. |
| [docs/compliance-architecture.md](docs/compliance-architecture.md) | Versioned regulatory rule store, ESRS-first mapping model. |
| [docs/design-system.md](docs/design-system.md) | Design language, tokens, components, signature UX patterns. |
| [docs/roadmap.md](docs/roadmap.md) | 14 phases, the vertical slice, per-phase workflow. |

## Tech stack (summary)

TypeScript · Node 22 · pnpm + Turborepo · NestJS API · Next.js 15 web · PostgreSQL 16 (RLS)
· Prisma · BullMQ/Redis · S3-compatible storage (EU) · Anthropic Claude behind an
`AIProvider` interface · Zod · Vitest / Testcontainers / Playwright · OpenTelemetry / pino /
Sentry.

Rationale and rejected alternatives: [docs/decisions/ADR-001-technology-stack.md](docs/decisions/ADR-001-technology-stack.md).

## Repository layout (target)

```
apps/
  web/        Next.js 15 application shell + all persona surfaces
  api/        NestJS HTTP API (/api/v1), OpenAPI, auth, RBAC, audit
  worker/     BullMQ worker — document processing, extraction, calculation, reports
packages/
  domain/     Pure TS: calculation engine, unit conversion, Trust Score, quality rules
  db/         Prisma schema, migrations, seed, tenant-scoped repositories
  ai/         AIProvider interface, Claude adapter, versioned prompts, output schemas
  compliance/ Versioned regulatory rule store (ESRS first) + mapping evaluator
  shared/     Zod schemas, DTOs, units registry, error taxonomy
  ui/         Design-system components (Tailwind v4 + Radix), tokens, charts, graph views
  config/     Env schema, shared tsconfig/eslint/prettier, lint boundary rules
```

## Getting started

Prerequisites: **Node 22+**, **pnpm 9** (`npm i -g pnpm@9` if `corepack` can't install it),
and a **PostgreSQL 16** database + **Redis** — either via Docker or hosted (EU region).

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL (and REDIS_URL for the worker)
```

**With Docker:**

```bash
docker compose up -d          # Postgres + Redis; also creates trace_test
```

**Without Docker:** point `DATABASE_URL` / `DATABASE_URL_TEST` in `.env` at a hosted
Postgres (Neon, Supabase, Railway, …) and `REDIS_URL` at a hosted Redis (Upstash, …).

Then:

```bash
pnpm db:migrate               # prisma migrate deploy — schema + RLS + audit guard
pnpm db:seed                  # seeds the "NordWerk Manufacturing AG" demo tenant
pnpm dev                      # api (:4000), web (:3000), worker
```

Sign in at http://localhost:3000 as `anke.roth@nordwerk.example`; the magic-link URL is
printed in the API server log (`EMAIL_TRANSPORT=console`). API docs:
http://localhost:4000/api/v1/docs.

### Checks

```bash
pnpm lint         # single root ESLint pass (flat config, enforces module boundaries)
pnpm typecheck    # tsc --noEmit across every package
pnpm test:unit    # Vitest unit suites (no database needed)
pnpm build        # turbo build of all packages + apps
# integration (needs Postgres):
pnpm --filter @trace/db exec prisma migrate deploy
pnpm --filter @trace/db test:integration   # tenant isolation / RLS
```

## Principles (load-bearing)

1. Evidence before reporting.
2. Every number has lineage.
3. Never hide uncertainty (`measured | supplier_reported | calculated | estimated | modeled | inferred`).
4. Human approval gates consequential outputs.
5. Auditability is a first-class feature.
6. Enterprise security from day one.
7. Regulatory logic is versioned data, not code.
8. Explainability — every automated calculation is reproducible.
9. Interoperability — clean APIs and adapters.
10. Built for European enterprise reality.

## License

Proprietary — © TRACE. All rights reserved. (Placeholder; confirm before first external
contribution.)
