# TRACE — Initial Engineering Assessment

**Document status:** Draft v1 — foundational
**Date:** 2026-09-08
**Author:** Lead product architect / staff engineering (acting)
**Audience:** Founders, first engineers, prospective technical diligence

---

## 0. Executive summary

TRACE is a **sustainability evidence and supply-chain intelligence platform** for European
enterprises. Its thesis is that large companies do not have an ESG *reporting* problem — they
have an ESG *evidence* problem. TRACE is the infrastructure layer that turns fragmented
supplier, procurement, logistics, operational and environmental data into a continuously
**traceable evidence system**: every material sustainability number is explainable back to a
source document, a supplier, an activity record, an emission factor, a methodology, a
calculation version, a reviewer and a regulatory disclosure.

This document records the state of the repository as found, the recommended technology and
architecture, the domain model, and a staged delivery plan. It concludes with the immediate
next steps, which are executed in **Phase 0** (`/docs` + Architecture Decision Records).

The guiding constraint: **build enterprise sustainability *evidence infrastructure*, not a
dashboard, not a CSRD report generator, not a chatbot over an emissions calculator.**

---

## 1. Current repository state

| Aspect | Finding |
| --- | --- |
| Working directory | `C:\Users\DELL\Desktop\STARTUPS\TRACE` |
| Git | Not initialised on inspection — **initialised as part of this assessment** |
| Existing source | None. Directory was empty. |
| Package manager | None present. Node 22.14 / npm 11.2 available; `corepack` present for pnpm. |
| Language / runtime | None chosen. Node 22 LTS-line and Python 3.13 are on the machine. |
| Database | None configured. No local Postgres/psql; no Docker daemon on this host. |
| Environment config | None. |
| Deployment config | None. |
| UI system | None. |
| Tests | None. |

**Conclusion:** this is a **greenfield project**. There is no prior work to preserve or
reverse-engineer. Every decision below is a first decision, which means we optimise for a
clean domain architecture and a defensible foundation rather than for compatibility with
legacy choices.

> Host note: Docker and a local Postgres are not installed on this development machine.
> The bootstrap plan (Section 9) accounts for this: the first milestone can run against a
> hosted Postgres/Redis (EU region) or a locally installed Postgres, and a
> `docker-compose.yml` is provided for contributors who do have Docker.

---

## 2. Product shape the architecture must serve

The architecture is judged against whether it can deliver, without rewrites, the **signature
vertical slice**:

```
Organization
  → Supplier
    → Supplier uploads a sustainability document
      → TRACE ingests and processes it
        → AI extracts emissions / activity data with source spans + confidence
          → Human reviews and approves the extraction
            → Evidence record created and linked
              → Calculation executed (deterministic, versioned)
                → TRACE Trust Score computed
                  → Scope 3 total updated
                    → Compliance (ESRS) mapping updated
                      → Audit readiness updated
```

Everything in the assessment exists to make that chain **real, reproducible and auditable** —
and to make each arrow a place where a human can inspect, override, and see history.

Non-negotiable product properties that drive technical choices:

1. **Every number has lineage.** Data model must make provenance a first-class column, not a
   comment.
2. **Uncertainty is never hidden.** `measured | supplier_reported | calculated | estimated |
   modeled | inferred` is a required attribute of any material datapoint.
3. **Human approval gates consequential outputs.** AI proposes; humans dispose. AI output
   lands in a *candidate* table, never directly in trusted reporting data.
4. **Auditability is a feature.** Append-only history for calculations, factors, evidence,
   regulatory mappings and a tamper-evident audit log.
5. **Regulatory logic is versioned data, not code.** ESRS/CSRD/Taxonomy/CBAM/EUDR concepts
   live in a versioned compliance rule store, not in React components or `if` branches.
6. **Enterprise & EU from day one.** Tenant isolation at the data layer, RBAC by permission,
   audit logs, encryption, EUR / metric / EU formats, GDPR-ready data lifecycle.

---

## 3. Recommended technology stack

Full rationale and rejected alternatives are in **ADR-001**. Summary:

| Layer | Choice | One-line reason |
| --- | --- | --- |
| Language | **TypeScript** (strict) end-to-end | One language, strong types across domain, API and UI; large EU hiring pool. |
| Runtime | **Node.js 22 LTS** | Current LTS line, native `fetch`, stable `AsyncLocalStorage` for request context. |
| Monorepo | **pnpm workspaces + Turborepo** | Enforced package boundaries between pure domain logic, DB, API and UI; cached builds. |
| Backend framework | **NestJS** | Module system with DI matches the modular-monolith goal; guards/interceptors give RBAC + audit logging as cross-cutting concerns; first-class OpenAPI; clean path to extracting services later. |
| API style | **REST, versioned (`/api/v1`), OpenAPI 3.1** | Enterprise integration expectations; contract-first; codegen for clients. Internal typed client for the web app. |
| Database | **PostgreSQL 16** | Relational integrity for lineage; `JSONB` for assumptions/metadata; **Row-Level Security** as defence-in-depth for tenancy; mature EU hosting. |
| ORM / query | **Prisma** (schema + migrations) with a repository layer | Migration tooling and DX maturity for a small team; tenant scoping enforced in repositories + Postgres RLS. Drizzle considered — see ADR-001. |
| Background jobs | **BullMQ** on **Redis** | Reliable retries, backoff, scheduled jobs, visible job state; `bull-board` for ops. |
| Object storage | **S3-compatible**, EU region (AWS `eu-central-1` or Scaleway/OVHcloud/Hetzner) behind a `StorageService` interface | Data sovereignty; signed URLs; no raw paths exposed. |
| AuthN | Email **magic-link + session cookies** for MVP; `AuthProvider` abstraction; **OIDC/SAML SSO** and **TOTP MFA** designed in | Removes password handling risk early; SSO is a Phase 13 switch, not a rewrite. |
| AuthZ | **Permission-based RBAC** (`evidence.verify`, `calculation.approve`, …) resolved to a permission set per request | Avoids `role === 'admin'` checks scattered through code. |
| Validation | **Zod** for env, API input, and AI output parsing | Single validation idiom; runtime + static types. |
| AI | **Anthropic Claude API** — `claude-sonnet-5` for extraction/reasoning, `claude-haiku-4-5` for classification — behind an `AIProvider` interface; every call recorded as an `AIJob` | Strong structured-output + long-context extraction; provider is swappable; full observability + cost tracking. |
| Document parsing | PDF text/layout (`pdfjs`), spreadsheets (`xlsx`/`exceljs`), CSV (`csv-parse`); OCR (Tesseract or cloud) deferred to Phase 5+ | Deterministic pre-processing before the LLM; keeps AI input auditable. |
| Frontend | **Next.js 15 (App Router) + React 19**, TypeScript | Mature enterprise React framework; server components for data-dense pages; consumes the versioned API. |
| Styling / components | **Tailwind CSS v4** + **Radix UI** primitives + a bespoke `@trace/ui` layer | Restrained, premium, accessible; no off-the-shelf "SaaS purple" kit. |
| Graph / lineage viz | **React Flow (xyflow)** for Evidence Graph, Evidence DNA and Carbon Twin | Node-graph interaction without a graph database in the MVP. |
| Charts | **visx** / lightweight D3, used sparingly | Meaningful visuals only; no chart clutter. |
| Testing | **Vitest** (unit), **Supertest + Testcontainers** (integration), **Playwright** (e2e) | Fast unit loop; real Postgres in integration; critical-flow coverage. |
| Observability | **OpenTelemetry** traces, **pino** structured logs with request IDs, **Sentry** errors, `bull-board` job monitoring | Production-readiness is Principle 6, not a later retrofit. |
| Secrets | Env via `dotenv` locally; managed secret store in deployment (never in logs) | Principle 19. |
| Deployment | Docker images; single EU region to start; managed Postgres + Redis; IaC (Terraform) when a second environment appears | Simplest thing that supports the roadmap. |

### Rejected / deferred

- **Microservices now** — rejected. Premature distribution tax for a pre-PMF team. Modular
  monolith with hard module boundaries (ADR-002).
- **Graph database (Neo4j) now** — deferred. Lineage is expressible in Postgres with a
  materialised `lineage_edge` projection; revisit only when traversal depth/perf demands it
  (Phase 14).
- **tRPC-only API** — rejected as the external contract. Enterprise buyers and integrators
  expect REST + OpenAPI. A typed internal client is fine on top of the same handlers.
- **Supabase / Firebase as the platform** — rejected. Tenant isolation, RLS nuance, audit
  hashing, job orchestration and compliance versioning need first-party control.
- **LangChain as the AI backbone** — rejected. Thin, explicit `AIProvider` + versioned
  prompt templates + Zod output schemas are more auditable and less churny.

---

## 4. Architecture overview

A **modular monolith** deployed as one API service plus one web app, with a job worker
process, all sharing packages in a pnpm monorepo.

```
apps/
  web/        Next.js 15 app — application shell, all persona surfaces
  api/        NestJS — HTTP API (/api/v1), OpenAPI, auth, RBAC, audit
  worker/     BullMQ worker process — document processing, extraction, calc, reports
packages/
  domain/     Pure TypeScript. No I/O. Calculation engine, unit conversion, Trust Score,
              compliance mapping, data-quality rules. 100% unit-testable.
  db/         Prisma schema, migrations, seed, repository base + tenant scoping.
  ai/         AIProvider interface, Claude adapter, versioned prompt templates, output schemas.
  compliance/ Versioned regulatory rule store (ESRS first), loaders, mapping evaluator.
  shared/     Zod schemas, DTOs, shared types, units registry, error taxonomy.
  ui/         Design-system components (Tailwind + Radix), tokens, charts, graph views.
  config/     Env schema (Zod), tsconfig/eslint/prettier base.
```

Layered dependency rule (enforced by lint boundaries):

```
web ─────────────► shared, ui
api ─────────────► domain, db, ai, compliance, shared
worker ──────────► domain, db, ai, compliance, shared
domain ──────────► (nothing — pure)
db ──────────────► shared
ai ──────────────► shared
compliance ──────► shared
```

**Domain logic never imports from `api`, `db`, or `ui`.** This keeps calculations, scoring
and compliance mapping reproducible and testable in isolation — a direct requirement of
Principles 8 and 41.

### Cross-cutting mechanisms (built in Phase 1, reused everywhere)

| Concern | Mechanism |
| --- | --- |
| Request context | `AsyncLocalStorage` carrying `{ organizationId, userId, permissions, requestId }`. |
| Tenant isolation | Repository layer refuses queries without an org scope; Postgres RLS policies keyed on a per-transaction `SET app.current_org`. |
| Authorization | `@RequirePermission('calculation.approve')` guard; permissions resolved from role→permission map per org. |
| Audit logging | NestJS interceptor + domain events → append-only `audit_log`, hash-chained (`hash = sha256(prev_hash + canonical_payload)`). |
| Versioning | Append-only rows + `supersedes_id` / `version` / `valid_from` / `valid_to`; no destructive updates on lineage entities. |
| Background work | Any operation >~200 ms or with external I/O is a BullMQ job with visible state (`queued → processing → completed | failed | retrying`). |
| Observability | OTel span per request/job; `requestId` propagated to logs, jobs and AI calls. |

---

## 5. Domain model (core)

The **lineage spine** — the chain every material number can be walked along:

```
Evidence ─ supports ─► Datapoint ─ input to ─► Calculation ─ produces ─► Emission
   ▲                        ▲                       │
   │                        │                       ├─ uses ─► EmissionFactor (versioned)
Document                ActivityData                └─ pinned ─► Methodology + assumptions
   ▲                        ▲
 upload                  Supplier / Facility / Product / Material / Transaction
```

Aggregates and key entities:

- **Tenancy & identity:** `Organization`, `BusinessUnit`, `User`, `Membership`, `Role`,
  `Permission`, `ApiKey`, `Session`.
- **Supply chain:** `Supplier`, `SupplierRelationship`, `SupplierPassport`, `Facility`,
  `Product`, `Material`, `Transaction` (procurement/logistics line items).
- **Activity & carbon:** `ActivityData`, `Unit`, `UnitConversion`, `EmissionFactor`
  (versioned, `source`, `version`, `valid_from/to`), `Methodology`, `Calculation`
  (immutable), `Emission` (rolled-up result with scope + GHG category).
- **Evidence:** `Document` (content-addressed, MIME-validated, checksum, retention),
  `Evidence` (typed, lifecycle state machine, confidence, hash), `Datapoint` (value + unit +
  `provenance` enum + trust score), `CandidateDatapoint` (AI output awaiting review),
  `Verification`.
- **Trust & quality:** `TrustScore` (value + itemised breakdown + model version),
  `DataQualityIssue`, `Anomaly`.
- **Compliance:** `Regulation`, `Requirement`, `Disclosure`, `RequiredDatapoint`,
  `EvidenceRequirement`, `Control`, `ComplianceMapping`, `DisclosureStatus` — all
  **version-stamped** from the `@trace/compliance` rule store.
- **Audit:** `Audit`, `AuditFinding`, `AuditPackage`, `AuditSimulationRun`.
- **Process & ops:** `Workflow`, `WorkflowInstance`, `Task`, `Notification`, `Integration`,
  `IntegrationRun`, `AIJob`, `AuditLog`, `Job` (mirror of queue state for UI).

Provenance enum (shared, load-bearing):

```ts
type Provenance =
  | 'measured'          // metered / directly observed
  | 'supplier_reported' // primary data from the supplier
  | 'calculated'        // deterministic from other datapoints
  | 'estimated'         // spend-based / average-data proxy
  | 'modeled'           // scenario / simulation output
  | 'inferred';         // AI or heuristic inference, not yet verified
```

`Datapoint.provenance` is **never** downgraded silently and is surfaced in every UI that
shows the number.

Full field-level model is in `docs/domain-model.md` and `docs/data-model.md`.

---

## 6. Database strategy

- **Single Postgres cluster, single schema, shared tables**, every tenant-owned row carries
  `organization_id NOT NULL` with an FK and a composite index `(organization_id, …)` on hot
  paths.
- **Row-Level Security** enabled on all tenant tables; policy `USING (organization_id =
  current_setting('app.current_org')::uuid)`. The app sets this per transaction. RLS is
  defence-in-depth behind the repository layer, not the only line.
- **Append-only lineage tables**: `calculation`, `emission_factor` versions, `evidence`
  versions, `compliance_mapping` versions, `audit_log`. Updates that would change a historical
  result instead insert a new row and set `supersedes_id`.
- **Soft delete** (`deleted_at`) only for non-evidence operational entities. Evidence,
  calculations and audit rows are never soft-deleted without a preserved, referenceable
  history record. GDPR erasure is handled by a documented **redaction** workflow that
  tombstones personal fields while preserving the lineage skeleton (see `docs/security.md`).
- **Migrations**: Prisma Migrate, checked in, forward-only in shared environments, reviewed
  like code.
- **Reproducibility**: `Calculation` stores every input by value *and* by reference
  (`input_value`, `input_unit`, `normalized_value`, `factor_value`, `factor_version`,
  `methodology`, `assumptions` JSONB, `calculation_version`). Re-running
  `@trace/domain.recompute(calc.inputs)` must reproduce `result_value` exactly.
- **Path to scale**: a large enterprise that requires physical isolation gets a dedicated
  database; connection routing by `organization_id` is added without changing domain or
  repository code.

---

## 7. AI strategy

- **Orchestrator + specialised capabilities**, not one monolithic AI service:
  Document Extraction · Classification · Data Quality · Evidence Reasoning ·
  Compliance Mapping · NL Analytics (Ask TRACE) · Recommendations.
- **`AIProvider` interface** with a Claude adapter (`claude-sonnet-5`,
  `claude-haiku-4-5`). Swappable; no vendor lock-in in domain code.
- **Deterministic pre-processing first**: parse text, tables and structure from the document
  with non-AI libraries, store that artifact, then pass bounded, cited context to the model.
- **Structured output**: every extraction returns JSON validated against a Zod schema, with
  `source_spans` (page + bounding region / cell reference) and a per-field `confidence`.
- **Human-in-the-loop by construction**: extraction writes `CandidateDatapoint` rows.
  A reviewer with `evidence.verify` / `calculation.approve` promotes them to `Datapoint`.
  No AI path writes trusted reporting data directly.
- **Every call is an `AIJob` record**: `model`, `prompt_version`, `input_ref`, `output`,
  `confidence`, `tokens_in/out`, `cost`, `latency_ms`, `reviewer_id`, `status`,
  `created_at`. Prompts are versioned files in `packages/ai/prompts`.
- **Labelling**: data carries a state — `ai_extracted → human_reviewed → verified`. The
  transition to `verified` requires either a human with the right permission or a documented
  deterministic validator. `ai_extracted → verified` automatically is disallowed.
- **Ask TRACE** is retrieval over structured TRACE records + evidence, never free
  generation; every factual claim links to the underlying rows. No answer without a source.
- **No fake AI**: where a capability is not yet implemented, the UI shows an explicit
  architecture boundary, not a fake "AI is analysing…" animation.

---

## 8. Security strategy

Security is treated as a product surface (Principle 6, 19). Mapping of the requirement
checklist to concrete controls (detail in `docs/security.md`):

| Area | Control |
| --- | --- |
| AuthN | Magic-link email login, short-lived signed session cookies (`httpOnly`, `Secure`, `SameSite=Lax`), rotating refresh; TOTP MFA-ready; `AuthProvider` abstraction for OIDC/SAML SSO. |
| AuthZ | Permission-based RBAC; deny-by-default guards; object-level checks (`organization_id` + resource ownership) on every read/write. |
| Tenant isolation | Repository scoping + Postgres RLS; automated cross-tenant access tests in CI (Principle 41). |
| Input | Zod validation at every API boundary; typed IDs; no mass-assignment. |
| Injection | Parameterised queries via Prisma; no string SQL; output encoding in React by default. |
| SSRF | Outbound fetch allow-list for integrations and `sourceUrl` ingestion; no fetching arbitrary user-supplied URLs from the server. |
| Files | MIME sniffing + extension check, size limits, checksum, malware-scan hook in the pipeline, private buckets, signed time-limited URLs, no raw storage paths. |
| Rate limiting | Per-IP and per-org/token limits on the API and auth endpoints. |
| Transport / headers | TLS everywhere, HSTS, CSP, `X-Content-Type-Options`, frame-ancestors none. |
| CSRF | SameSite cookies + double-submit token for cookie-authed mutating routes. |
| Secrets | Managed secret store in deployment; never logged; `.env` git-ignored; pre-commit secret scan. |
| Audit | Append-only, hash-chained `audit_log`; captures actor, action, before/after, request ID. |
| Logging hygiene | Never log passwords, tokens, API keys, or document contents; PII scrubbing in the log pipeline. |
| Dependencies | `pnpm audit` + Renovate/Dependabot + CI SCA gate. |
| GDPR-ready | Data inventory, purpose tags on personal fields, export and redaction workflows, retention policies, EU-region processing, DPA-ready sub-processor list. No unqualified "GDPR compliant" claims. |

---

## 9. Development roadmap

The 14 product phases stand. They are grouped here by delivery horizon; the **first real
milestone is the vertical slice**, which spans Phases 0–7 in a deliberately thin form before
any phase is built out to full breadth.

### Near term — "prove the spine"

| Phase | Outcome | Definition of done |
| --- | --- | --- |
| **0. Foundation** *(this turn)* | `/docs` + ADR-001…005; monorepo scaffold plan. | A new engineer can read `docs/` and understand the system before opening code. |
| **1. App foundation** | Auth, org onboarding, users, roles, permissions, app shell, DB, migrations, tenant isolation, audit log. | A user creates an org, invites users, logs in, works in an isolated tenant. |
| **2. Supplier intelligence** | Supplier directory, detail, relationships, invitation, portal foundation, passport, supplier evidence. | An enterprise invites a supplier and collects sustainability information. |
| **3. Evidence infrastructure** | Document upload/storage/metadata, evidence records + lifecycle, viewer, versioning, linking, audit history. | Any sustainability datapoint can be linked to evidence. |
| **4. Carbon engine** | Activity data, emission factors, units/conversions, deterministic calculation engine, Scope 1/2, initial Scope 3 (cats 1,4,6,7,9), calculation lineage. | A user can reproduce every emissions calculation. |
| **5. AI document intelligence** | Ingestion, extraction pipeline, classification, structured extraction with confidence + spans, human review, evidence linking. | A supplier PDF becomes structured data through a reviewable AI workflow. |
| **6. Trust engine** | Trust Score (documented model), data-quality checks, anomaly detection, completeness/freshness, issue management. | TRACE can explain how trustworthy every major datapoint is. |
| **7. Compliance** | Requirements, required datapoints, disclosure mapping, ESRS foundation, evidence requirements, gaps, status. | Users trace requirement → datapoint → calculation → evidence. |

At the end of Phase 7 the signature demo (Section 2) runs end to end on real, seeded data.

### Mid term — "make it an auditor's tool and an executive's tool"

| Phase | Outcome |
| --- | --- |
| **8. Audit workspace** | Readiness, findings, evidence review, controls, audit package, audit simulation. |
| **9. Command Center** | Executive dashboard built strictly on real model data — readiness, gaps, hotspots, prioritised actions. |
| **10. Ask TRACE** | NL analytics as retrieval over structured data + evidence, every answer sourced. |
| **11. Procurement intelligence** | Supplier comparison, carbon intensity, procurement scenarios, what-if, recommendations. |

### Long term — "become infrastructure"

| Phase | Outcome |
| --- | --- |
| **12. Enterprise integrations** | CSV/XLSX → REST → SFTP → SAP/Dynamics/Oracle/Coupa adapters, built only against validated customer use cases. |
| **13. Enterprise readiness** | SSO, MFA, SCIM, enterprise audit logs, advanced RBAC, export, retention, monitoring, billing, usage limits, API keys, webhooks. |
| **14. Carbon Twin / network** | Supply-chain graph, hotspots, network benchmarking, product carbon footprints, scenario engine; introduce a graph store only if traversal needs justify it. |

### Per-phase workflow (Principle 39)

Domain requirement → inspect repo → assess architectural impact → update docs/ADR →
domain logic → DB → API → frontend → tests → lint → typecheck → unit → integration →
security review → UX review → docs → change summary. Commits are scoped and conventional
(`feat(evidence): implement evidence lifecycle`).

---

## 10. Immediate next steps

1. **Phase 0 — documentation (executing now):**
   - `README.md`
   - `docs/product-vision.md`, `architecture.md`, `domain-model.md`, `data-model.md`,
     `api.md`, `security.md`, `ai-architecture.md`, `compliance-architecture.md`,
     `design-system.md`, `roadmap.md`
   - `docs/decisions/ADR-001-technology-stack.md` … `ADR-005-ai-architecture.md`
2. **Phase 1 kickoff (next):**
   - Scaffold the pnpm + Turborepo monorepo (`apps/`, `packages/` per Section 4).
   - `packages/config`: Zod env schema, shared tsconfig/eslint/prettier, lint boundary rules.
   - `packages/db`: Prisma schema for tenancy/identity/audit; first migration; RLS policies;
     repository base with tenant scoping; deterministic seed for **NordWerk Manufacturing AG**.
   - `apps/api`: NestJS bootstrap, request-context middleware, RBAC guard, audit interceptor,
     magic-link auth, org onboarding, user/role/permission endpoints, OpenAPI.
   - `apps/web`: Next.js shell, navigation per Section 22 of the brief, auth flow, org
     switcher, empty states.
   - CI: install → lint → typecheck → unit → integration (Testcontainers Postgres) →
     build. Branch protection.
   - `docker-compose.yml` (Postgres + Redis) for contributors with Docker; documented hosted
     alternative for this host.
3. **Definition of done for Phase 1:** a user can create an organization, invite users, log
   in, and operate inside a secure, tenant-isolated workspace, with every consequential
   action written to the hash-chained audit log.

---

## 11. Consequential assumptions (recorded, not blocking)

| # | Assumption | If wrong |
| --- | --- | --- |
| A1 | TypeScript/Node/NestJS is acceptable to the team; no mandate for JVM/.NET/Python backend. | ADR-001 is revisited; domain package (pure TS) is the main rework. |
| A2 | Postgres is the system of record; no early requirement for a managed graph DB. | Phase 14 introduces a graph store behind the existing lineage projection. |
| A3 | Anthropic Claude is an acceptable primary AI provider for EU data (with appropriate DPA / data-processing terms). | `AIProvider` swap; prompts and output schemas are provider-neutral. |
| A4 | Initial hosting in an EU region (provider TBD) is sufficient; no day-one on-prem requirement. | Deployment packaging already container-based; on-prem becomes a Helm chart. |
| A5 | MVP auth can be magic-link; enterprise SSO is Phase 13. | `AuthProvider` abstraction absorbs it; no domain impact. |
| A6 | "European market, English-first UI" for MVP, with i18n structure in place for later locales. | i18n scaffolding from Phase 1 keeps this cheap. |
| A7 | Emission-factor datasets (e.g. DEFRA, EXIOBASE, ecoinvent, ADEME) will be licensed/loaded later; the engine ships with a small documented demo factor set clearly marked as such. | Factor loader is source-agnostic; only data provenance metadata changes. |

---

*Next: Phase 0 deliverables land under `docs/` and `docs/decisions/`.*
