# ADR-004: Evidence and data-lineage strategy

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 0

## Context

The core value of TRACE is that **every material sustainability number is explainable** —
walkable back to a supplier, a document, activity data, an emission factor version, a
methodology, a reviewer and a disclosure (Principles 2, 5, 8, 35). Historical results must
stay reproducible even after emission factors or methodologies change. This must be a data
model property, not a reporting afterthought, and it must not require a graph database in
the MVP (brief §14).

## Options considered

### Representing lineage

- **A1 — Generic edge table only.**
  `lineage_edge(from_type, from_id, relation, to_type, to_id)` as the source of truth.
  - Pros: flexible; easy graph traversal.
  - Cons: no referential integrity; typos in `*_type`; hard to enforce "a calculation must
    reference exactly one factor version"; queries need application-level joins.

- **A2 — Typed foreign keys only.**
  `calculation.emission_factor_id`, `datapoint_evidence(datapoint_id, evidence_id)`, etc.
  - Pros: full referential integrity; DB-enforced cardinality; fast, indexable joins.
  - Cons: arbitrary-depth graph traversal (for the Evidence Graph UI) means many joins /
    recursive CTEs.

- **A3 — Typed FKs as source of truth + a materialised `lineage_edge` projection.**
  FKs enforce integrity; domain events maintain a denormalised edge table for traversal and
  visualisation; the projection is fully rebuildable from the FKs.
  - Pros: integrity **and** cheap traversal; no graph DB; projection can be dropped/rebuilt.
  - Cons: projection maintenance code; eventual consistency between FKs and edges (bounded,
    and rebuildable).

### Handling change over time

- **B1 — Mutable rows, updated in place.** Rejected: silently changes historical results;
  destroys audit value.
- **B2 — Append-only lineage entities + explicit supersession / versioning.** Chosen.

## Decision

**A3 + B2.**

### Lineage

- **Typed FK columns are the source of truth** for every lineage relationship
  (`calculation.activity_id`, `calculation.emission_factor_id`, `datapoint_evidence`,
  `emission.source_calculation_ids`, `compliance_mapping.datapoint_id`, …).
- A **materialised `lineage_edge` projection**
  (`organization_id, from_type, from_id, relation, to_type, to_id, created_at`) is
  maintained by domain events and powers the Evidence Graph, Evidence DNA and future Carbon
  Twin. It is a cache: a rebuild job can regenerate it entirely from the FKs.

### Provenance

- Every `datapoint` and `activity_data` row carries a required `provenance` enum:
  `measured | supplier_reported | calculated | estimated | modeled | inferred`. It is
  surfaced in every UI and export and is never downgraded silently (Principle 3).
- Data also carries a `label` lifecycle: `ai_extracted → human_reviewed → verified`
  (auto `ai_extracted → verified` is disallowed).

### Immutability & versioning

- `calculation` is **insert-only**. Recomputation inserts a new row with `supersedes_id`
  and a fresh `calculation_version`. Each row stores inputs **by value and by reference**
  (`input_value/unit`, `normalized_value/unit`, `factor_value/unit`, `factor_source`,
  `factor_version`, `methodology`, `assumptions` JSONB) so
  `@trace/domain.recompute(inputs)` reproduces `result_value` exactly.
- `emission_factor` rows are versioned (`version`, `valid_from`, `valid_to`). A calculation
  FKs a **specific version row**; a 2027 factor update never alters a 2026 calculation.
- `evidence` is versioned (`version`, `supersedes_id`) with a lifecycle state machine
  (`uploaded → processing → extracted → reviewed → verified → expired|superseded`, plus
  `rejected`). Content is content-addressed (`document.checksum_sha256`); `evidence.hash`
  binds the evidence record to its supporting content.
- `compliance_mapping` and `trust_score` are insert-only and stamped with
  `rule_store_version` / `model_version` respectively.

### Audit backbone

- `audit_log` is append-only and **hash-chained**
  (`hash = sha256(prev_hash || canonical_json(entry))`); `UPDATE`/`DELETE` privileges are
  revoked from the app role and blocked by a trigger. A `verify` endpoint recomputes the
  chain.

### Deletion

- Evidence, calculations and audit rows are **never hard-deleted**. GDPR erasure is a
  **redaction** workflow that tombstones personal fields while preserving the lineage
  skeleton, recorded in `audit_log`. Soft delete (`deleted_at`) is allowed only on
  non-evidence operational entities.

## Consequences

- **Positive:** any number resolves to a full, navigable, reproducible lineage; historical
  reports are stable across factor/method changes; tamper-evidence on the audit trail;
  Evidence Graph works on Postgres alone.
- **Trade-offs accepted:** more rows (append-only growth — mitigated by partitioning /
  archival later); projection-maintenance code and bounded eventual consistency in
  `lineage_edge`; recompute creates history rather than editing, so UIs must always show
  "current" vs "superseded".
- **Commits us to:** storing full calculation inputs on every row; event-driven projection
  and audit writes; a canonical-JSON serializer for hashing; a `lineage_edge` rebuild job.

## Revisit when

- `lineage_edge` traversal depth/perf on real customer graphs outgrows recursive CTEs →
  introduce a graph database as a second projection (Phase 14), FKs still the source of
  truth.
- Append-only table growth needs partitioning or cold storage.
