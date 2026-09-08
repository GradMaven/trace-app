# ADR-006: Trust Score model & data-quality engine

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 6

## Context

Every material number in TRACE must carry not just lineage but a defensible answer to _how
much should I trust this?_ (brief §9, Principle 3 "never hide uncertainty"). Phase 6 adds a
**TRACE Trust Score** per datapoint, a **data-quality check engine**, and **anomaly
detection**. The brief requires the scoring model to be documented and configurable
(§9), every score to render its breakdown (Principle 9), automated outputs to be
reproducible (Principle 8), and AI never to make the consequential call (Principle 4).

## Options considered

### Scoring model

- **A1 — A learned / ML trust model.** Rejected: not explainable per datapoint, not
  reproducible, needs labelled data we do not have, and drifts silently. Fails §9 and
  Principle 8.
- **A2 — A documented additive model**: fixed dimensions, each contributing 0..max, score =
  sum, 0–100, with a stored per-dimension breakdown and a `trust-model@x.y.z` version.
  - Pros: every point of the score is attributable to a rule and a fact; reproducible;
    the weight table is data a customer can reason about and (later) tune.
  - **Chosen.** Dimensions and weights are exactly the table in
    `docs/domain-model.md#trace-trust-score-model` (primary data 25, evidence 20, verified
    15, factor quality 15, unit/methodology 10, period freshness 9, completeness 6).

### Where the logic lives

- **B1 — In the API / DB layer.** Rejected: not unit-testable in isolation, easy to drift.
- **B2 — Pure functions in `@trace/domain`** (`scoreDatapoint`, `evaluateDatapointQuality`,
  `detectAnomalies`), with `@trace/db` gathering inputs and persisting rows.
  - **Chosen.** Matches ADR-002 boundaries and the carbon-engine pattern from Phase 4.

### Trust Score storage

- **C1 — One mutable row per datapoint.** Rejected: loses history, breaks auditability.
- **C2 — Immutable, version-chained rows** (`trust_score.supersedesId`), current = the row
  with no successor; a recompute with an identical input digest is a no-op.
  - **Chosen**, mirroring the immutable `calculation` table.

### Data-quality issues on re-scan

- **D1 — Delete and re-create issues each scan.** Rejected: loses the human triage state
  (acknowledged / dismissed) and the first-seen timestamp.
- **D2 — Idempotent upsert on a natural `dedupeKey`**
  (`kind|subjectType|subjectId|metricKey|reportingPeriod`): an existing issue is refreshed
  (`lastSeenAt`, text, severity); an open/acknowledged issue no longer detected is
  **auto-resolved** with a note; `dismissed` is sticky (records a human judgement); a
  recurrence reopens an auto-resolved issue.
  - **Chosen.**

### Anomaly detection

- **E1 — Statistical + LLM explanation.** Deferred: the LLM "explain this anomaly"
  capability is a later phase; Phase 6 ships deterministic detectors only.
- **E2 — Deterministic detectors** — Iglewicz–Hoaglin modified z-score (median/MAD) over a
  datapoint's own history and across peers, plus period-over-period step detection — each
  finding carrying factual candidate explanations. A human marks each `explained` or
  `dismissed`; nothing is auto-actioned.
  - **Chosen.**

## Decision

- `@trace/domain/trust`: `scoreDatapoint` (`trust-model@1.0.0`), `evaluateDatapointQuality`
  (`quality-rules@1.0.0`, 12 issue kinds), `detectAnomalies` (`anomaly-detector@1.0.0`).
  All pure, all versioned, all unit-tested.
- `@trace/db`: `trust_score` (immutable, chained), `data_quality_issue` (idempotent upsert
  - auto-resolve), `anomaly` (idempotent upsert), `quality_scan` (run record). RLS
    (`0012_trust_rls`) FORCEs `current_org()` on all four. Orchestrators `scoreDatapointTrust`,
    `runQualityScan`, `updateIssueStatus`, `updateAnomalyStatus`; every mutation is
    hash-chain audit-logged (a full scan writes one summary entry, an individual recompute
    its own).
- `apps/api`: `/trust/scores`, `/trust/scores/:datapointId` (+ `/recompute`),
  `/data-quality/summary|scans|scan|issues|anomalies` with `trust.read` / `trust.run` /
  `quality.manage` permissions. The datapoint Evidence-DNA response carries its Trust
  Score, open issues and anomalies.
- `apps/web`: **Data → Data Quality** (dashboard + scan history + run), issue triage,
  anomaly triage, and a Trust Score breakdown panel on the datapoint page.

## Consequences

- The score is only as good as its inputs; a datapoint with no evidence and an
  unrecognised factor source is _meant_ to score low — the demo seed shows exactly that
  and it is a feature, not a bug.
- The recognised-emission-factor-source list is a small hard-coded set today; it should
  become versioned reference data alongside the factor library.
- `activeReportingPeriod` comes from `organization.reportingPeriodConfig.activePeriod`
  (falling back to `FY{lastYear}`); multi-period orgs will need a richer period model.
- Re-scoring is wholesale per scan; for large tenants this should move to the worker and
  become incremental (only datapoints whose inputs changed).
- Changing any weight or rule bumps the model/rules version; historical rows keep the
  version they were computed with, so trends stay honest.
