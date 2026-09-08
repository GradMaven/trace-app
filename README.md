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

**Phase 1 — Application foundation (landed).** Monorepo, backend/domain packages, NestJS
API, Next.js shell, Prisma schema + migrations, tenant isolation, hash-chained audit log,
and the NordWerk demo seed. Builds, typechecks, lints, and unit tests are green; the
Postgres-dependent integration suite (RLS / tenant isolation) runs in CI. See
[docs/roadmap.md](docs/roadmap.md) for exact status and what's next (Phase 2 — Supplier
Intelligence).

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
