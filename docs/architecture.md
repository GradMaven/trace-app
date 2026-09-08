# Architecture

## Shape

A **modular monolith**: one API service, one web app, one job worker, sharing packages in a
pnpm + Turborepo monorepo. Hard module boundaries keep domain logic pure and let us extract
services later without a rewrite. Rationale: [ADR-002](decisions/ADR-002-modular-monolith.md).

## Layers

```
┌──────────────────────────────────────────────┐
│  Web App (Next.js 15, React 19)              │  application shell, persona surfaces
├──────────────────────────────────────────────┤
│  Application API (NestJS, /api/v1, OpenAPI)  │  auth, RBAC, validation, audit interceptor
├──────────────────────────────────────────────┤
│  Domain Services                             │  orchestration of the pure domain
├──────────────────────────────────────────────┤
│  Calculation │ Evidence │ Compliance │ Trust │  bounded contexts
├──────────────────────────────────────────────┤
│  Persistence / Data (Prisma + Postgres, RLS)│  repositories enforce tenant scope
├──────────────────────────────────────────────┤
│  Files │ Search │ AI │ Integrations         │  adapters behind interfaces
└──────────────────────────────────────────────┘
```

Domain logic is independent of UI and transport. No business logic in API route handlers or
React components.

## Monorepo layout

```
apps/
  web/        Next.js 15 app router; consumes the versioned API via a typed client
  api/        NestJS; HTTP only; thin controllers delegating to domain services
  worker/     BullMQ worker; same domain services, triggered by queue
packages/
  domain/     Pure TypeScript, zero I/O. Calculation engine, unit conversion, Trust Score,
              data-quality rules, compliance mapping evaluation. 100% unit-testable.
  db/         Prisma schema, migrations, seed, repository base class + tenant scoping helpers
  ai/         AIProvider interface, Claude adapter, prompt templates (versioned), Zod
              output schemas, AIJob recording
  compliance/ Versioned regulatory rule store (ESRS first), loaders, mapping evaluator
  shared/     Zod schemas, DTOs, shared types, units registry, error taxonomy, constants
  ui/         Design-system components (Tailwind v4 + Radix), tokens, charts, graph views
  config/     Zod env schema, base tsconfig/eslint/prettier, eslint boundary rules
```

## Dependency rule

```
web        → shared, ui
api        → domain, db, ai, compliance, shared
worker     → domain, db, ai, compliance, shared
domain     → (nothing)
db         → shared
ai         → shared
compliance → shared
```

Enforced by `eslint-plugin-boundaries` / `import/no-restricted-paths`. A violation fails
CI. `domain` importing from `db`, `api`, or `ui` is the canonical thing we prevent.

## Bounded contexts

| Context | Owns | Key invariants |
| --- | --- | --- |
| **Identity & Tenancy** | Organization, BusinessUnit, User, Membership, Role, Permission, Session, ApiKey | Every tenant row has `organization_id`; RLS enforced. |
| **Supply Chain** | Supplier, SupplierRelationship, SupplierPassport, Facility, Product, Material, Transaction | A supplier belongs to exactly one organization context per relationship. |
| **Carbon** | ActivityData, Unit, UnitConversion, EmissionFactor (versioned), Methodology, Calculation (immutable), Emission | A calculation pins a specific EmissionFactor version; results never change silently. |
| **Evidence** | Document, Evidence (lifecycle), Datapoint, CandidateDatapoint, Verification | Evidence has a lifecycle state; content is hash-addressed; nothing hard-deleted. |
| **Trust & Quality** | TrustScore, DataQualityIssue, Anomaly | Score is reproducible from inputs + model version. |
| **Compliance** | Regulation, Requirement, Disclosure, RequiredDatapoint, EvidenceRequirement, Control, ComplianceMapping, DisclosureStatus | Every mapping carries the rule-store version it was evaluated against. |
| **Audit** | Audit, AuditFinding, AuditPackage, AuditSimulationRun | Findings link to concrete objects; audit log is append-only + hash-chained. |
| **Process** | Workflow, WorkflowInstance, Task, Notification | Workflow engine is generic and reusable. |
| **Integrations** | Integration, IntegrationRun | All external I/O behind `IntegrationAdapter`. |
| **AI Ops** | AIJob | Every model call is recorded before its output is used. |

## Cross-cutting mechanisms (Phase 1, reused everywhere)

### Request context

`AsyncLocalStorage` holds `{ requestId, organizationId, userId, permissions, locale }` for
the lifetime of a request or job. Repositories and services read tenant + actor from here,
never from ad-hoc parameters that can be forgotten.

### Tenant isolation

Two independent layers (defence in depth):

1. **Repository layer** — a base repository injects `organization_id` into every `where`
   and every `create`. Direct Prisma model access outside repositories is banned by lint.
2. **Postgres RLS** — every tenant table has a policy
   `USING (organization_id = current_setting('app.current_org')::uuid)`. The DB layer runs
   each unit of work in a transaction that first executes `SET LOCAL app.current_org = $1`.

Cross-tenant access is covered by automated tests in CI.

### Authorization

Permission-based. Guards declare `@RequirePermission('calculation.approve')`. A per-request
permission set is resolved from the actor's roles within the current organization. No
`role === 'x'` checks in feature code.

### Audit logging

A NestJS interceptor plus domain events write to an append-only `audit_log`:
`{ id, organization_id, actor_id, action, resource_type, resource_id, before, after,
request_id, created_at, prev_hash, hash }` where
`hash = sha256(prev_hash || canonical_json(payload))`. Any material state change is logged.

### Versioning

Lineage entities are append-only. A change that would alter a historical result inserts a
new row and sets `supersedes_id` (or bumps `version` with `valid_from`/`valid_to`).
`Calculation` rows are immutable. See [ADR-004](decisions/ADR-004-evidence-lineage.md).

### Background jobs

Anything with external I/O or >~200 ms of work is a BullMQ job with an explicit state
(`queued → processing → completed | failed | retrying`), mirrored to a `job` row for the UI.
No heavy work inside HTTP handlers.

### Observability

OpenTelemetry span per request and per job; `pino` structured logs carrying `requestId`;
Sentry for errors; `bull-board` for the queue. AI calls, document processing and
integration runs each expose a visible status.

## Environments

| Env | Notes |
| --- | --- |
| Local | pnpm dev; Postgres + Redis via `docker compose` **or** a hosted EU instance for machines without Docker. |
| CI | Ephemeral Postgres via Testcontainers for integration tests. |
| Staging / Prod | Container images, single EU region initially; managed Postgres + Redis; IaC (Terraform) added when a second environment exists. |

## Evolution path

- **Extract a service** when a context has an independent scaling or team-ownership need —
  most likely `worker`/AI processing first. Module boundaries + the `domain` package make
  this mechanical.
- **Dedicated DB per tenant** for enterprises requiring physical isolation — connection
  routing by `organization_id`; no domain/repository change.
- **Graph database** only in Phase 14 if lineage traversal depth/perf demands it; the
  `lineage_edge` projection is the seam.
