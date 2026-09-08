# Roadmap

The 14 product phases from the brief, grouped by delivery horizon. The **first real
milestone is the vertical slice** — a deliberately thin path through Phases 1–7 — proven on
seeded data before any single phase is built to full breadth.

## Signature vertical slice (the north-star demo)

```
Organization → Supplier → Supplier uploads a sustainability document →
TRACE ingests & processes → AI extracts emissions/activity data (spans + confidence) →
Human reviews & approves → Evidence created & linked → Calculation executed (versioned) →
Trust Score generated → Scope 3 updated → Compliance (ESRS) mapping updated →
Audit readiness updated
```

Delivering this end to end is worth more than 50 disconnected features.

## Near term — prove the spine

| Phase | Scope | Definition of done |
| --- | --- | --- |
| **0 — Foundation** ✅ | `/docs`, ADR-001…005, repo scaffold plan. | A new engineer understands the system from `docs/` before opening code. |
| **1 — App foundation** 🚧 *(landed; live-DB verification pending)* | Monorepo (pnpm + Turborepo), `@trace/{config,shared,domain,db}`, NestJS API (magic-link auth, permission RBAC guard, CSRF guard, hash-chained audit interceptor path, OpenAPI), Next.js shell + navigation + auth/onboarding/members/roles/audit-log screens, BullMQ worker skeleton, Prisma schema + migrations (init + RLS + audit-guard), tenant-scoped `withOrgContext`, NordWerk seed, CI. | A user creates an org, invites users, logs in, works in a secure tenant-isolated workspace; every consequential action is audit-logged. **Status:** builds, typechecks, lints, unit tests green; RLS + migrations + seed run in CI against Postgres; not yet run against a live DB on the dev machine (no local Postgres). |
| **2 — Supplier intelligence** 🚧 *(landed; live-DB verification pending)* | Supplier directory + create/detail/archive, contacts, locations, customer↔supplier relationship; supplier-portal-user invitation (`Membership.supplierId`); supplier portal (overview, questionnaire fill/submit, evidence refs); fixed sustainability questionnaire in `@trace/domain`; versioned **Supplier Passport** builder with per-field provenance; passport recompute on submit/accept; RLS on all supplier tables (`0004`); NordWerk seed extended with 20 suppliers + 3 completed passports. | An enterprise invites a supplier and collects sustainability information. **Status:** lint / typecheck / 43 unit tests / build green; supplier-flow + RLS integration tests run in CI; not yet run against a live DB locally. |
| **3 — Evidence infrastructure** 🚧 *(landed; live-DB verification pending)* | `@trace/storage` package (`StorageService` + local-disk driver with HMAC-signed download URLs + S3 driver); document upload (multipart, MIME allowlist + magic-byte check, SHA-256, content-addressed dedupe, malware-scan hook); `Document`, `Evidence` (lifecycle state machine in `@trace/domain`, versioned via `supersedesId`), `Datapoint`, `datapoint_evidence`, `EvidenceVerification`; evidence transitions with permission gating (`evidence.verify` for verify/reject); evidence viewer + Evidence-DNA datapoint page; supplier evidence-ref → Evidence promotion; portal document upload; migrations `0005`/`0006` (+ RLS). Seed adds 2 verified evidence records + 3 linked datapoints. | Any sustainability datapoint can be linked to evidence. **Status:** lint / typecheck / 54 unit tests / build green; evidence-flow + RLS integration tests run in CI; not yet run against a live DB locally. |
| **4 — Carbon engine** | Activity data, emission factors (versioned), units + conversions, deterministic calculation engine, Scope 1, Scope 2 (location + market), Scope 3 categories 1/4/6/7/9, calculation lineage. | A user can reproduce every emissions calculation exactly from stored inputs. |
| **5 — AI document intelligence** | Ingestion, extraction pipeline, classification, structured extraction (confidence + source spans), human review queue, evidence linking. | A supplier PDF becomes structured, reviewable data through a human-gated AI workflow. |
| **6 — Trust engine** | TRACE Trust Score (documented model), data-quality checks, anomaly detection, completeness + freshness, issue management. | TRACE can explain how trustworthy every major datapoint is. |
| **7 — Compliance** | Requirements, required datapoints, disclosure mapping, ESRS foundation, evidence requirements, gaps, status tracking. | Users trace requirement → datapoint → calculation → evidence. |

At the end of Phase 7 the vertical-slice demo runs on the **NordWerk Manufacturing AG**
seed.

## Mid term — auditor's tool, executive's tool

| Phase | Scope |
| --- | --- |
| **8 — Audit workspace** | Readiness, findings, evidence review, controls, audit package export, audit simulation. Auditor can review the evidence chain without engineering help. |
| **9 — Command Center** | Polished executive dashboard built **only** on real model data (no fabricated metrics). |
| **10 — Ask TRACE** | NL analytics as retrieval over structured data + evidence; every factual answer sourced. |
| **11 — Procurement intelligence** | Supplier comparison, carbon intensity, procurement scenarios, what-if, supplier recommendations, reduction opportunities. |

## Long term — become infrastructure

| Phase | Scope |
| --- | --- |
| **12 — Enterprise integrations** | CSV/XLSX → REST → SFTP → SAP/Dynamics/Oracle/Coupa adapters. Built only against a validated customer use case. `IntegrationAdapter` interface first. |
| **13 — Enterprise readiness** | SSO (OIDC/SAML), MFA, SCIM, enterprise audit logs, advanced RBAC, data export, retention policies, advanced monitoring, billing, usage limits, API keys, webhooks. |
| **14 — Carbon Twin / network** | Supply-chain graph, carbon hotspots, supplier network, product carbon footprints, scenario engine, network benchmarking. Introduce a graph database only if traversal needs justify it. |

## Per-phase workflow (Principle 39)

1. Understand the domain requirement.
2. Inspect the existing repository; never overwrite work without understanding it.
3. Identify architectural impact.
4. Create / update documentation + ADR if a decision is consequential.
5. Implement domain logic (`packages/domain` — pure, tested).
6. Implement database changes (`packages/db` — schema + migration + RLS).
7. Implement APIs (`apps/api` — thin controllers, Zod DTOs, guards, OpenAPI).
8. Implement frontend (`apps/web` + `packages/ui`).
9. Implement tests (unit / integration / e2e / security as applicable).
10. Lint. 11. Typecheck. 12. Unit tests. 13. Integration tests.
14. Security review (per `docs/security.md`).
15. UX review (per the Principle 42 checklist).
16. Update documentation.
17. Summarise what changed.

Commits are scoped and conventional:
`feat(evidence): implement evidence lifecycle`,
`feat(carbon): add deterministic calculation engine`, etc. No enormous unreviewable commits.

## Quality bar (Principle 40) — never merge with

TypeScript errors · failing tests · broken imports · unused code · placeholder production
logic · fabricated metrics · hard-coded user-specific data · duplicated business logic ·
security shortcuts · unvalidated API input · missing tenant checks · undocumented
architectural decisions.

## Definition of "demo-ready"

Running `pnpm db:seed` produces a live-looking **NordWerk Manufacturing AG** tenant: 20
suppliers, 5 facilities, 15 materials, 10 products, activity records, calculations,
emissions, evidence documents, compliance gaps, audit findings — all explicitly flagged as
seed/demo data.
