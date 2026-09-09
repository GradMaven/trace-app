# ADR-008: Audit workspace — readiness model & package format

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 8

## Context

Phase 8 gives an auditor a workspace to assess and evidence audit-readiness without
engineering help (roadmap DoD). It must: score how defensible the reported numbers are;
raise navigable findings (Principle 10); let a person triage them; and produce an
**exportable package** an external auditor can work from. It must not overclaim — TRACE
supports professional judgement and never asserts an assurance opinion (Principle 44).

## Options considered

### Readiness scoring

- **A1 — A single opaque "audit-ready %".** Rejected: not explainable, not reproducible.
- **A2 — A documented additive model** (`audit-readiness@1.0.0`), pure, in `@trace/domain`,
  aggregating what Phases 3–7 already produce: evidence verified (25), calculations
  reproducible (20), calculations approved (15), data quality (15), Trust level (10),
  compliance mapping (10), audit-trail integrity (5). Returns a per-dimension breakdown
  **and** itemised issues, each with a `subjectType` / `subjectId`.
  - **Chosen.** Same pattern as the Trust engine (Phase 6); the simulation composes
    `reproduceCalculation`, `verifyAuditChain`, the data-quality issues, Trust Scores and
    the compliance mappings rather than re-deriving them.

### Findings on re-run

- **A1 — Recreate every run.** Rejected: destroys triage state and first-seen dates.
- **A2 — Idempotent upsert on `dedupeKey`** (`sim:<kind>|<subjectType>|<subjectId>`): an
  open finding is refreshed, one no longer detected is **auto-resolved** with a note, and
  `accepted_risk` / `dismissed` are sticky. `source = manual` findings are raised by a
  person, carry a random `dedupeKey`, and are never auto-resolved.
  - **Chosen** — mirrors Phase 6 data-quality issues.

### Audit package

- **A1 — Rendered PDF.** Deferred: a PDF is a downstream rendering; the source of truth is
  structured. A report renderer is a later phase.
- **A2 — A canonical-JSON bundle written to object storage, content-addressed by its
  SHA-256.** Sections: `meta` (with disclaimer), `organization`, `readiness` (the latest
  simulation breakdown), `inventory` (`summariseInventory`), `evidence` (+ verifications),
  `calculations` (inputs + steps + factor + approval + a live `reproduce` check),
  `datapoints` (+ lineage refs + Trust), `compliance` (mappings + gaps), `findings` (open),
  `auditTrail` (`verifyAuditChain` result + head hash). A `manifest` row holds counts.
  - **Chosen.** `@trace/db` takes `putBytes` as a dependency (like Phase 5's `fetchBytes`)
    so it need not import `@trace/storage`; the API injects the real `StorageService` and
    serves a short-lived signed download URL.

## Decision

- **`@trace/domain/audit/readiness.ts`**: `assessReadiness(input) → { value, band,
modelVersion, breakdown[], issues[] }`, pure, `audit-readiness@1.0.0`, 9 unit tests. Band
  reuses the Trust thresholds (`high ≥ 75`, `medium ≥ 50`, `low`).
- **`@trace/db/audit-workspace.ts`**: `runAuditSimulation` (gather → assess → upsert
  `audit_simulation_run` + `audit_finding`, one `audit.simulation_completed` audit entry),
  `createAudit` / `updateAudit`, `createFinding` / `updateFinding`, `generateAuditPackage`,
  `auditReadiness` / `evidenceReviewList` / `evidenceChain`. Models `audit`,
  `audit_finding`, `audit_simulation_run`, `audit_package`; migrations `0015` + `0016`
  (RLS `FORCE current_org()` on all four).
- **`apps/api`**: `AuditWorkspaceModule` — `/audit/{readiness,simulate,simulations,audits,
findings,evidence-review,evidence-chain/:id}` and `/audit/packages{,/:id,/:id/download}`
  with `audit.read` / `audit.manage`. `audit.manage` is granted to `sustainability_manager`
  (the auditor role stays read-only).
- **`apps/web`**: Audit → Readiness (score + breakdown + engagements + package list),
  Findings (triage), Evidence Review (per-datapoint chain health) + a per-datapoint
  **evidence-chain** page that walks disclosure → datapoint → calculation → activity →
  factor → evidence → verifications, Controls (read-only), Audit Package (generate +
  download).
- Seed: opens an FY2025 engagement, runs the simulation, triages two findings, generates a
  package.

## Consequences

- The readiness score is only as good as the inputs; the demo scores mid-range because the
  seed's calculations are unapproved and its factor sources are illustrative — that is the
  intended, honest picture.
- The package embeds a live `reproduce` result per calculation, so generating it is O(calcs)
  DB work; for large inventories this should move to the worker.
- Package content is canonical JSON only. A human-readable report (PDF/HTML) and an
  `AuditPackage` signing step are future work.
- `evidence-chain` is read-only composition over existing helpers; it deliberately does not
  add new lineage storage.
- Changing any readiness weight bumps `audit-readiness@x.y.z`; historical simulation runs
  keep the version and breakdown they were computed with.
