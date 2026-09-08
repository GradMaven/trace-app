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
| **4 — Carbon engine** 🚧 *(landed; live-DB verification pending)* | `@trace/domain` carbon engine: unit registry + `convert` (decimal.js, exact), `computeEmission` (deterministic, stores every step, `recompute` reproduces bit-for-bit), `selectEmissionFactor` (explainable ranking), `summariseInventory`/`aggregateEmissions` (Scope 2 location vs market). DB: `emission_factor` (versioned, library + org), `activity_data` (+`activity_evidence`), immutable `calculation` (all inputs by value + reference + steps + factor-selection reasons), `emission` rollup projection; `datapoint.calculation_id`. Helpers `runCalculation` / `reproduceCalculation` / `recomputeCalculation` / `recomputeEmissions`. API: emission-factors, activity-data, calculations (run / lineage / reproduce / recompute / approve), emissions (summary / recompute). Web: Activity Data, Calculations, Scope 1/2/3, Emission Factors, and the **calculation lineage** page; Command Center shows real Scope 1/2/3 totals. Migrations `0007`/`0008` (+ RLS). Seed: 8 illustrative library factors + 1 supplier-specific, 6 activities, calculations, FY2025 rollup, Rheinstahl evidence→activity link. | A user can reproduce every emissions calculation exactly from stored inputs. **Status:** lint / typecheck / 79 unit tests / build green; carbon-flow + RLS integration tests run in CI; not yet run against a live DB locally. |
| **5 — AI document intelligence** 🚧 *(landed; live-DB verification pending)* | `@trace/ai` package: `AIProvider` interface + **Claude adapter** (forced tool-use, Zod-validated output, token/cost accounting) + a deterministic **dev stub** (heuristic extraction, clearly labelled — used when no key). Deterministic pre-processing (`parseDocument`: text/csv native, PDF via pdf-parse). Capabilities `classifyDocument` + `extractDatapoints` with versioned prompts (`prompts/*.md` mirrors). DB: `ai_job` (every call recorded before use), `document_extraction` (parsed artifact + pipeline state), `candidate_datapoint` (AI output — never trusted). `@trace/db` orchestrator `runExtractionPipeline` (parse → classify → extract → candidates) + `promoteCandidate` (→ Datapoint + evidence from the document, human-gated) / `rejectCandidate`. API: `POST /documents/:id/process`, `GET /documents/:id/extraction`, `candidate-datapoints` (queue / promote / reject), `ai-jobs` (log). Worker: `document-processing` BullMQ queue. Web: Review Queue + candidate review screen (source span highlighted in parsed context), AI Log. Migrations `0009`/`0010` (+ RLS). Seed: a demo report processed via the stub → candidates, 2 promoted. | A supplier PDF becomes structured, reviewable data through a human-gated AI workflow. **Status:** lint / typecheck / 89 unit tests / build green; ai-extraction-flow + RLS integration tests run in CI; not yet run against a live DB or a live Claude key locally. |
| **6 — Trust engine** 🚧 *(landed; live-DB verification pending)* | `@trace/domain/trust`: `scoreDatapoint` (documented additive **TRACE Trust Score**, `trust-model@1.0.0` — primary data / evidence / verified / factor quality / unit-methodology / period freshness / completeness, 0–100 with a stored per-dimension breakdown), `evaluateDatapointQuality` (`quality-rules@1.0.0`, 12 issue kinds: missing value/unit/evidence, unverified/expired evidence, stale data, unit inconsistency, impossible value, duplicate, conflicting supplier report, outdated factor, low methodology tier), `detectAnomalies` (`anomaly-detector@1.0.0` — modified z-score over history + peers, period-over-period step). DB: immutable version-chained `trust_score`, idempotent `data_quality_issue` (dedupe key, auto-resolve, sticky dismiss) + `anomaly`, `quality_scan` run record; migrations `0011`/`0012` (+ RLS). Orchestrators `scoreDatapointTrust` / `runQualityScan` / `updateIssueStatus` / `updateAnomalyStatus`, all audit-logged. API: `/trust/scores` (+ `/:datapointId` + `/recompute`), `/data-quality/{summary,scans,scan,issues,anomalies}`; perms `trust.read` / `trust.run` / `quality.manage`; the datapoint Evidence-DNA response carries its score, issues and anomalies. Web: **Data → Data Quality** dashboard + scan history + run, issue and anomaly triage queues, and the Trust Score breakdown on the datapoint page. Seed: FY2025 scan over the NordWerk tenant. | A user can see, and explain from its breakdown, how trustworthy every major datapoint is. **Status:** lint / typecheck / 124 unit tests / build green; trust-flow + RLS integration tests run in CI; not yet run against a live DB locally. |
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
