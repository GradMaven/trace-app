# ADR-007: Compliance rule store & mapping engine

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 7

## Context

CSRD/ESRS (and later EU Taxonomy, CSDDD, CBAM, EUDR, ESPR, GHG Protocol, ISSB) rules must
be **versioned data, not code** (Principle 7). No screen may say "compliant"
(compliance-architecture.md, Principle 44). Every status must be traceable to the
contributing datapoints, calculations and evidence (Principle 10) and reproducible against
the rule-store version it was evaluated under (Principle 8). Phase 7 delivers an ESRS E1
(climate) first slice.

## Options considered

### Where regulatory logic lives

- **A1 — Encoded in React components / API `if` branches.** Rejected outright by Principle 7.
- **A2 — A versioned rule store (`Regulation → Requirement → Disclosure → RequiredDatapoint
/ EvidenceRequirement / Control`), evaluated by one generic engine.** Every node carries a
  `rule_store_version` (`esrs@2026.1`); superseding a version inserts new rows and never
  mutates prior ones.
  - **Chosen.** The store ships as frozen, typed data in `@trace/compliance`
    (`rules/<regulation>-<version>.ts`); `@trace/db.loadRuleStore` idempotently upserts it
    into the global `regulation` … `evidence_requirement` tables.

### The rule-store tables

- **B1 — Tenant-scoped copies per organization.** Rejected: the rules are the same for
  everyone; per-tenant copies drift and bloat.
- **B2 — Global rows (no `organization_id`), repository-scoped, NOT RLS'd** — exactly like
  `emission_factor` library rows. Only the tenant's _results_ (`compliance_mapping`,
  `disclosure_status`, `compliance_control`, `compliance_run`) are RLS'd.
  - **Chosen.**

### The engine

- **C1 — Deterministic + LLM decides final status.** Rejected: AI must never set a
  consequential compliance status (Principle 4). The `compliance-mapping` AI capability may
  later _propose_ candidate links, but a human confirms and the engine sets status.
- **C2 — A pure function in `@trace/compliance`** (`evaluateRuleStore`) that, given the
  tenant's candidate datapoints (with evidence / trust / factor-validity summaries)
  produces an objective status per required datapoint and rolls those up to disclosures.
  - **Chosen.** `@trace/db` gathers inputs and persists rows; the arithmetic is pure and
    unit-tested, matching the carbon (Phase 4) and trust (Phase 6) engines.

### Status ladder

`not_started → data_available → evidence_available → mapping_complete`, with
`review_required` as an **override** when data exists but has a problem (conflicting
candidates, expired-only evidence, outdated factor, unit mismatch, low Trust Score). A
disclosure is `not_started` if any required datapoint is; else `review_required` if any is;
else the lowest remaining ladder state. `mapping_complete` additionally needs a **human
confirmation** and a Trust Score at or above the required-datapoint's threshold.

### Reconciling multiple candidates

Additive metrics (Scope 1 = stationary + mobile combustion) would otherwise look like
"conflicting data". Each `RequiredDatapoint` declares an `aggregation` — `single` (default;

> 2% apart ⇒ `conflicting_data`), `sum`, or `latest`.

## Decision

- **`@trace/compliance`** (pure, `@trace/shared` only): rule-store types + registry,
  `ESRS_2026_1` data (E1-1 transition plan, E1-4 targets, E1-5 energy & mix, E1-6 gross
  Scope 1/2/3), `evaluateRuleStore` / `evaluateRequiredDatapoint`, `rollUpDisclosureStatus`
  / `readinessPct`. Deeply frozen — versioned data is never mutated in place.
- **`@trace/db`**: global `regulation` / `requirement` / `disclosure` / `required_datapoint`
  / `evidence_requirement`; tenant `compliance_control` / `compliance_mapping` /
  `disclosure_status` / `compliance_run` (migrations `0013` + `0014` RLS). Orchestrators
  `loadRuleStore`, `runComplianceEvaluation` (idempotent upsert on
  `[org, requiredDatapoint, version]`, preserves `confirmed`), `confirmMapping`,
  `upsertControl`; every mutation is hash-chain audit-logged (`compliance.evaluated`,
  `compliance.mapping_confirmed`, `compliance.control_updated`). The ADR-002 boundary is
  extended to `db → shared, domain, ai, compliance`.
- **`apps/api`**: `/compliance/overview|rule-stores|evaluate|gaps|runs|disclosures/:id|
mappings/:id/confirm|controls` with `compliance.read` / `compliance.manage`.
- **`apps/web`**: Compliance → Requirements (tree + readiness + load/evaluate), Disclosures
  (list), a disclosure "why" page (required datapoint → matched datapoint → calculation →
  evidence, gap reasons, confirm), Gaps. A persistent disclaimer on every screen.
- Seed: loads `esrs@2026.1`, evaluates FY2025, confirms the Scope 3 purchased-goods mapping,
  records two E1-6 controls.

## Consequences

- The E1 slice is illustrative and partial — not the full ESRS datapoint set. The rule
  store's `notice` says so and it is surfaced in the UI.
- `readinessPct` is an indicative ladder-progress mean, explicitly **not** a compliance
  percentage.
- Upgrading to `esrs@2027.1` produces new mapping rows; old ones remain for audit. A report
  package (Phase 8+) records the version it was built against.
- The `compliance-mapping` AI capability (candidate link proposals) and conditional
  `RequiredDatapoint.conditions` evaluation are deferred; the schema already carries
  `conditions`.
- Re-evaluation is wholesale; for large rule stores it should become incremental and move
  to the worker.
