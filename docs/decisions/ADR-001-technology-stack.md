# ADR-001: Technology stack

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 0

## Context

TRACE is a greenfield enterprise SaaS for the European market. It must support, without a
rewrite: data lineage and provenance on every material number; a deterministic, versioned
carbon engine; human-gated AI document extraction; multi-tenant isolation; permission-based
RBAC; a tamper-evident audit log; background job processing; document storage; a versioned
compliance rule store; API-first integration; and a premium, data-dense UI.

Constraints and forces:

- Small team, pre-PMF — developer velocity and a low operational surface matter.
- Strong typing across domain, API and UI is a stated requirement (brief §15).
- Enterprise buyers expect REST + OpenAPI, SSO, audit logs, tenant isolation.
- EU data residency and GDPR-ready architecture.
- The host dev machine has Node 22, npm, git, Python 3.13; **no Docker daemon**, no local
  Postgres.

Relevant principles: 6 (enterprise security from day one), 8 (explainability /
reproducibility), 9 (interoperability), 15 (technology strategy — choose the simplest
architecture that supports the roadmap; not trendy for its own sake).

## Options considered

### Backend language / runtime

- **TypeScript on Node.js 22** — one language across the stack; largest EU hiring pool for
  full-stack product engineers; excellent typing; native `fetch`, stable
  `AsyncLocalStorage`. Weaker for CPU-bound numeric work (mitigated: the carbon engine is
  simple arithmetic on `decimal` types, not heavy computation).
- **Python (FastAPI)** — strong data/AI ecosystem; but a second language if the frontend is
  TS, weaker large-codebase typing ergonomics, and the AI work here is API calls +
  orchestration, not model training.
- **JVM (Kotlin) / .NET** — excellent for large enterprise backends and correctness; higher
  ceremony and slower iteration for a tiny team; two languages with a TS frontend.

**Chosen: TypeScript / Node 22.** One language, strong types end to end, fastest iteration
for this team; numeric concerns are addressed with a decimal library and stored-input
reproducibility, not raw compute.

### Backend framework

- **NestJS** — module system with dependency injection maps directly to the
  modular-monolith goal (ADR-002); guards and interceptors give RBAC and audit logging as
  clean cross-cutting concerns; first-class OpenAPI; clear path to extracting services.
  Cost: more boilerplate than a micro-framework.
- **Fastify / Express + hand-rolled structure** — lighter, but we would rebuild DI, module
  boundaries, and the guard/interceptor model NestJS already provides.
- **Next.js API routes + tRPC only** — fastest for a pure web app; but the brief demands an
  external, versioned REST + OpenAPI contract for integrators, and route-handler code
  tends to accumulate business logic (violates brief §16).

**Chosen: NestJS** for the API and worker; **Next.js** for the web app consuming it via a
generated typed client. Same handlers, one contract.

### Database & data access

- **PostgreSQL 16** — relational integrity for the lineage spine; `JSONB` for
  assumptions/metadata; native **Row-Level Security** for tenant defence-in-depth; mature
  EU managed hosting. Chosen without serious contest.
- ORM: **Prisma** vs **Drizzle**.
  - *Prisma*: best-in-class migrations and DX, typed client, large community — good for a
    small team. Query engine is less transparent for hand-tuning complex joins; RLS needs a
    per-transaction `SET LOCAL` via `$executeRaw`.
  - *Drizzle*: SQL-first, thin, great for complex/graph-ish queries and explicit tenant
    `where` composition; younger migration tooling.

**Chosen: Prisma**, with tenant scoping enforced in a repository layer **and** Postgres RLS.
Migration maturity and DX win for the current team size. Drizzle stays a viable escape
hatch for specific hot queries (it can coexist on the same DB) and this ADR is explicitly
revisitable if Prisma's query planner becomes a bottleneck on lineage traversal.

### Background jobs

- **BullMQ on Redis** — reliable retries/backoff, repeatable jobs, visible state,
  `bull-board` UI. Chosen.
- pg-boss (Postgres-only, one less dependency) — considered; Redis is also wanted for
  caching/rate-limiting, so BullMQ's ecosystem wins.

### AI

- **Anthropic Claude API behind an `AIProvider` interface** — strong structured output and
  long-context extraction; `claude-sonnet-5` for extraction/reasoning, `claude-haiku-4-5`
  for classification. Provider-neutral prompts + Zod output schemas; every call recorded as
  `AIJob`. **LangChain rejected** as the backbone — a thin explicit adapter is more
  auditable and less churn-prone, which matters given Principle 4/27.

### Frontend

- **Next.js 15 (App Router) + React 19 + TypeScript** — mature enterprise React framework,
  server components suit data-dense pages, strong ecosystem.
- **Tailwind CSS v4 + Radix primitives + bespoke `@trace/ui`** — restrained premium look,
  accessible primitives, no off-the-shelf "SaaS purple" kit.
- **React Flow (xyflow)** for lineage/graph views; **visx** for the few charts that earn
  their place.

### Monorepo & tooling

- **pnpm workspaces + Turborepo** — enforced package boundaries (pure `domain`, `db`, `ai`,
  `compliance`, `shared`, `ui`, `config`), cached builds. `corepack` ships with Node 22.
  npm workspaces is the fallback if pnpm is unavailable in an environment.
- **Zod** for env, API input and AI-output validation. **Vitest** (unit),
  **Supertest + Testcontainers** (integration), **Playwright** (e2e).
- **OpenTelemetry + pino + Sentry** for observability; `bull-board` for jobs.

### Hosting / deployment

- Container images; single **EU region** initially; managed Postgres + Redis;
  S3-compatible object storage in the EU (AWS `eu-central-1`, or Scaleway / OVHcloud /
  Hetzner for stronger sovereignty) behind a `StorageService` interface. IaC (Terraform)
  added when a second environment exists. Kubernetes deferred.

## Decision

Adopt the stack above: **TypeScript / Node 22 · pnpm + Turborepo · NestJS (API + worker) ·
Next.js 15 (web) · PostgreSQL 16 with RLS · Prisma · BullMQ/Redis · EU S3-compatible storage
· Anthropic Claude behind `AIProvider` · Zod · Vitest/Testcontainers/Playwright · OTel/pino/
Sentry.**

## Implementation notes (Phase 1)

- **Module system:** backend packages and `apps/api` / `apps/worker` compile to
  **CommonJS** (`module: commonjs`, `moduleResolution: node`, no `.js` import
  extensions). NestJS's decorator + `emitDecoratorMetadata` DI is far more reliable on
  CJS than on NodeNext ESM, and "boring and reliable" wins here (Principle 40). `apps/web`
  is ESM as Next.js requires. Revisit if the ecosystem's ESM-under-Nest story matures.
- **Package manager bootstrap:** `corepack` could not write pnpm into a protected Node
  install dir on the dev machine; pnpm 9 was installed at user scope instead
  (`npm i -g pnpm@9`). The lockfile and `packageManager` field still pin pnpm 9.15.
- **ESLint:** a single root `eslint .` run (flat config) is the lint gate — running
  `eslint` per-package in parallel via Turborepo crashed on this Windows host. Module
  boundaries are enforced with `no-restricted-imports` groups per package path.
- **`consistent-type-imports` is disabled for `apps/api`** because it rewrites
  constructor-injected classes to type-only imports and breaks Nest DI.

## Consequences

- **Positive:** one language end to end; strong types across domain/API/UI; clean
  cross-cutting concerns (RBAC, audit) via NestJS; mature migrations; reproducible
  calculations via stored inputs; provider-swappable AI; low initial ops surface.
- **Trade-offs accepted:** NestJS boilerplate; Prisma's opaque query engine for complex
  joins; Node's weaker CPU-bound story (not on the critical path); Redis as an extra
  dependency.
- **Commits us to:** a decimal library for money/quantities (no floats); repository layer
  discipline (no raw model access outside `packages/db`); prompt/version discipline in
  `packages/ai`; lint-enforced module boundaries.

## Revisit when

- Lineage/graph traversal performance forces a graph database (expected no earlier than
  Phase 14) — revisit ORM and store together.
- A validated enterprise requirement mandates a non-Node backend or on-prem deployment
  model.
- AI provider terms/data-residency change such that Claude is no longer suitable for EU
  customer data — execute the `AIProvider` swap.
- Team growth or domain complexity justifies splitting a bounded context into its own
  service (see ADR-002).
