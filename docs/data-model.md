# Data Model

Physical persistence design. Conceptual model: [domain-model.md](domain-model.md).
Store: **PostgreSQL 16**. ORM: **Prisma**. Access: **tenant-scoped repositories** +
**Row-Level Security**.

## Conventions

| Rule | Detail |
| --- | --- |
| Primary keys | `uuid` (v7 where possible for index locality), column `id`. |
| Tenant column | Every tenant-owned table: `organization_id uuid NOT NULL REFERENCES organization(id)`. |
| Timestamps | `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz`. |
| Money | `numeric(18,2)`, currency code column; EUR default. Never floats for money. |
| Quantities | `numeric(20,6)` with an explicit `unit` FK/text. Never floats where reproducibility matters. |
| Enums | Postgres enums for closed sets (`provenance`, `evidence_type`, `scope`, …). |
| JSON | `jsonb` for `assumptions`, `metadata`, `breakdown`, `source_spans`. |
| Soft delete | `deleted_at timestamptz` only on non-evidence operational tables. |
| Naming | `snake_case` tables and columns; singular table names. |

## Multi-tenancy at the data layer

1. **Repository base class** adds `organization_id` to every `where`/`create`/`update`.
   Raw `prisma.<model>` access outside `packages/db` repositories fails lint.
2. **RLS**: for each tenant table
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON <t>
     USING (organization_id = current_setting('app.current_org')::uuid)
     WITH CHECK (organization_id = current_setting('app.current_org')::uuid);
   ```
   The DB layer wraps each unit of work:
   ```sql
   BEGIN; SET LOCAL app.current_org = $orgId; ...; COMMIT;
   ```
3. **Platform-level tables** (`organization`, global `user`, `permission` catalog) are not
   tenant-scoped and are accessed through a separate, narrowly-permissioned path.

Full rationale: [ADR-003](decisions/ADR-003-multi-tenancy.md).

## Versioning & immutability

| Table | Strategy |
| --- | --- |
| `calculation` | Insert-only. No `UPDATE`. Recompute → new row + `supersedes_id`. |
| `emission_factor` | Versioned rows: `version`, `valid_from`, `valid_to`. Calculations FK a specific row. |
| `evidence` | Versioned: `version`, `supersedes_id`; state transitions logged, content hash stored. |
| `compliance_mapping` | Versioned by `rule_store_version`; re-evaluation inserts new rows. |
| `trust_score` | Insert-only; `model_version` stored; latest per subject via view. |
| `audit_log` | Append-only, hash-chained; no delete, no update (enforced by trigger + revoked privileges). |

Historical reproducibility (Principle 35): a report generated in FY2026 must reproduce even
after factors change in 2027, because every `calculation` row is frozen with its inputs.

## Core tables (Phase 1–4 scope)

### Identity & tenancy

```
organization(id, legal_name, country, base_currency, reporting_period_config jsonb,
             status, created_at, updated_at)
business_unit(id, organization_id, parent_id, name, created_at)
user(id, email UNIQUE, name, status, mfa_enabled, created_at)          -- platform-level
membership(id, organization_id, user_id, status, created_at,
           UNIQUE(organization_id, user_id))
role(id, organization_id NULL, key, name, is_platform, created_at)
permission(key PRIMARY KEY, description)                                -- catalog
role_permission(role_id, permission_key, PRIMARY KEY(role_id, permission_key))
membership_role(membership_id, role_id, PRIMARY KEY(membership_id, role_id))
session(id, user_id, organization_id NULL, mfa_passed, expires_at, created_at,
        ip, user_agent_hash)
api_key(id, organization_id, name, hashed_key, permissions text[], last_used_at,
        expires_at, created_at, revoked_at)                            -- Phase 13
```

### Supply chain

```
supplier(id, organization_id, name, country, industry_nace, registration_ids jsonb,
         status, created_at, updated_at, deleted_at)
supplier_location(id, organization_id, supplier_id, kind, geo point, address jsonb)
supplier_relationship(id, organization_id, supplier_id, category, tier, annual_spend numeric,
                      currency, since date, created_at)
supplier_passport(id, organization_id, supplier_id, version, data jsonb, computed_at,
                  UNIQUE(supplier_id, version))
facility(id, organization_id, supplier_id NULL, name, kind, geo point,
         operational_control bool, created_at)
product(id, organization_id, name, sku, unit, pcf_value numeric NULL, pcf_unit NULL,
        created_at)
material(id, organization_id, name, category, default_emission_factor_id NULL, created_at)
transaction(id, organization_id, supplier_id, product_id NULL, material_id NULL,
            quantity numeric(20,6), unit, spend numeric(18,2), currency, occurred_on date,
            origin jsonb, destination jsonb, source_ref, created_at)
```

### Carbon

```
unit(code PRIMARY KEY, dimension, si_factor numeric, description)
unit_conversion(from_code, to_code, factor numeric(30,12), PRIMARY KEY(from_code, to_code))
methodology(id, key, name, quality_tier smallint, description)
emission_factor(id, organization_id NULL, source, source_ref, name, value numeric(30,12),
                unit, gwp_set, scope, ghg_category, geography, version, valid_from date,
                valid_to date NULL, created_at,
                UNIQUE(source, source_ref, version))
activity_data(id, organization_id, subject_type, subject_id, category, value numeric(20,6),
              unit, reporting_period, provenance, source_ref, created_at, deleted_at)
calculation(id, organization_id, activity_id, emission_factor_id, methodology,
            input_value numeric(20,6), input_unit, normalized_value numeric(20,6),
            normalized_unit, factor_value numeric(30,12), factor_unit, factor_source,
            factor_version, result_value numeric(20,6), result_unit, assumptions jsonb,
            calculation_version, calculated_at, supersedes_id NULL)
emission(id, organization_id, scope, ghg_category, reporting_period,
         value_tco2e numeric(20,6), method_summary, computed_at,
         source_calculation_ids uuid[])
```

### Evidence

```
document(id, organization_id, filename, mime, size_bytes, checksum_sha256,
         storage_key, version, processing_status, retention_until date NULL,
         uploaded_by, created_at)
evidence(id, organization_id, type, title, document_id NULL, source, source_url,
         reporting_period, issuer, uploaded_by, uploaded_at, verification_status,
         verification_method, confidence_score numeric(5,2), hash, metadata jsonb,
         version, supersedes_id NULL, created_at)
datapoint(id, organization_id, subject_type, subject_id, metric_key, value numeric(20,6),
          unit, provenance, reporting_period, trust_score_id NULL, label, created_at,
          updated_at)
datapoint_evidence(datapoint_id, evidence_id, PRIMARY KEY(datapoint_id, evidence_id))
candidate_datapoint(id, organization_id, ai_job_id, document_id, metric_key,
                    value numeric(20,6), unit, provenance, reporting_period,
                    source_spans jsonb, confidence numeric(5,2), status, reviewed_by NULL,
                    reviewed_at NULL, created_at)
verification(id, organization_id, subject_type, subject_id, method, verified_by,
             verified_at, outcome, notes)
```

### Trust, quality, compliance, audit, process

```
-- trust_score / data_quality_issue / anomaly / quality_scan: see
-- "### Trust engine (Phase 6)" below for the implemented shape.

regulation(id, key, name, jurisdiction, rule_store_version)
requirement(id, regulation_id, code, title, description, rule_store_version)
disclosure(id, requirement_id, code, title, guidance, rule_store_version)
required_datapoint(id, disclosure_id, metric_key, unit, cardinality, rule_store_version)
evidence_requirement(id, disclosure_id, description, acceptable_types text[],
                     rule_store_version)
control(id, organization_id, requirement_id, name, owner, status, last_tested_at)
compliance_mapping(id, organization_id, required_datapoint_id, datapoint_id NULL,
                   calculation_id NULL, status, gap_reason, rule_store_version, computed_at)
disclosure_status(id, organization_id, disclosure_id, status, updated_at)

audit(id, organization_id, scope, period, status, created_at)
audit_finding(id, organization_id, audit_id NULL, severity, subject_type, subject_id,
              title, detail, status, created_at, resolved_at NULL)
audit_package(id, organization_id, audit_id, storage_key, generated_at, generated_by)
audit_simulation_run(id, organization_id, readiness_pct numeric(5,2), summary jsonb,
                     created_at)

workflow(id, organization_id NULL, key, name, definition jsonb, version)
workflow_instance(id, organization_id, workflow_id, subject_type, subject_id, state,
                  context jsonb, created_at, updated_at)
task(id, organization_id, title, assignee_id NULL, due_on date NULL, subject_type,
     subject_id, state, created_at, updated_at)
notification(id, organization_id, user_id, kind, payload jsonb, read_at NULL, created_at)
integration(id, organization_id, kind, config jsonb, status, created_at)
integration_run(id, organization_id, integration_id, state, stats jsonb, started_at,
                finished_at NULL, error jsonb NULL)
ai_job(id, organization_id, capability, model, prompt_version, input_type, input_ref,
       output jsonb, confidence numeric(5,2), tokens_in int, tokens_out int,
       cost_eur numeric(12,6), latency_ms int, reviewer_id NULL, status, created_at)
job(id, organization_id NULL, queue, name, state, attempts int, last_error text NULL,
    created_at, updated_at)
audit_log(id, organization_id NULL, actor_id NULL, action, resource_type, resource_id,
          before jsonb, after jsonb, request_id, created_at, prev_hash, hash)
```

### Supply chain (Phase 2)

```
supplier(id, organization_id, name, country, industry_nace, registration_ids jsonb,
         status supplier_status, created_by_user_id, created_at, updated_at, deleted_at)
supplier_contact(id, organization_id, supplier_id, email, name, role, is_primary,
                 UNIQUE(supplier_id, email))
supplier_location(id, organization_id, supplier_id, kind, label, country, address jsonb,
                  latitude, longitude)
supplier_relationship(id, organization_id, supplier_id UNIQUE, category, tier,
                      annual_spend numeric(18,2), currency, since date)
supplier_request(id, organization_id, supplier_id, kind, template_version, title, message,
                 status supplier_request_status, due_on date, responses jsonb,
                 created_by_user_id, sent_at, submitted_at, submitted_by_user_id, reviewed_at)
supplier_evidence_ref(id, organization_id, supplier_id, request_id NULL, type evidence_type,
                      title, source_url, note, reporting_period, verified,
                      submitted_by_user_id)      -- Phase 3 links these to document + evidence
supplier_passport(id, organization_id, supplier_id, version, builder_version, completeness,
                  data jsonb, computed_at, computed_by_user_id, UNIQUE(supplier_id, version))
```

- `membership.supplier_id` / `invitation.supplier_id` (nullable) scope a supplier-portal
  user to exactly one supplier.
- `supplier_request.responses` is keyed by question id; the template lives in
  `@trace/domain` (`SUPPLIER_QUESTIONNAIRE`, `QUESTIONNAIRE_VERSION`).
- `supplier_passport` is **append-only** and versioned: `recomputeSupplierPassport`
  inserts `version = max+1` from the supplier profile + latest submitted questionnaire +
  evidence summary via `@trace/domain.buildPassport`; each field in `data` carries a
  `provenance` (`supplier_reported` / `measured` / `not_provided`).
- RLS (`FORCE`, `current_org()`) on all seven tables — migration `0004_suppliers_rls`.

### Evidence (Phase 3)

```
document(id, organization_id, filename, mime, size_bytes, checksum_sha256, storage_key,
         storage_driver, version, processing_status document_processing_status,
         scan_status scan_status, retention_until date, uploaded_by_user_id)
  @@index(organization_id, created_at); @@index(organization_id, checksum_sha256)
evidence(id, organization_id, type evidence_type, title, document_id NULL, source, source_url,
         reporting_period, issuer, confidence_score numeric(5,2), hash, metadata jsonb,
         status evidence_status, version, supersedes_id NULL, uploaded_by_user_id, expires_at date)
  @@index(organization_id, status); @@index(organization_id, type)
datapoint(id, organization_id, metric_key, value_numeric numeric(20,6) NULL, value_text NULL,
          unit NULL, provenance provenance, label data_label, reporting_period,
          subject_type, subject_id, created_by_user_id)
  @@index(organization_id, subject_type, subject_id); @@index(organization_id, metric_key)
datapoint_evidence(organization_id, datapoint_id, evidence_id, linked_by_user_id, linked_at,
                   @@id(datapoint_id, evidence_id))
evidence_verification(id, organization_id, evidence_id, method, outcome, verified_by_user_id,
                      verified_at, notes)
```

- **Storage** is abstracted by `@trace/storage` (`StorageService`): a local-disk driver
  (dev — HMAC-signed URLs served by the API's `/storage/local` route) and an
  S3-compatible driver (deployment — native presigned GET). Storage keys are opaque and
  content-addressed: `docs/<org>/<sha256>/<filename>`.
- **Evidence lifecycle** is a pure state machine in `@trace/domain`
  (`uploaded → processing → extracted → reviewed → verified → expired|superseded`, plus
  `rejected`). `verified`/`rejected`/`expired` transitions require `evidence.verify`;
  others require `evidence.update`. Superseding inserts a new `version` row with
  `supersedes_id` and marks the old one `superseded` (append-only, ADR-004).
- `datapoint.label` tracks the trust lifecycle (`ai_extracted → human_reviewed →
  verified`); `provenance` is never downgraded silently.
- RLS (`FORCE`, `current_org()`) on all five tables — migration `0006_evidence_rls`.
- `supplier_evidence_ref` gained `document_id` and `promoted_evidence_id`: a
  supplier-submitted reference can be promoted into a first-class `evidence` row.

### Carbon (Phase 4)

```
emission_factor(id, organization_id NULL, source, source_ref, name, value numeric(30,12),
                numerator_unit co2e_unit, denominator_unit, activity_dimension, gwp_set,
                scope ghg_scope, ghg_category NULL, geography NULL, methodology NULL,
                valid_from date, valid_to date NULL, version, is_current, notes)
  -- organization_id NULL => shared library; scoped by the repository layer (like `role`)
activity_data(id, organization_id, scope ghg_scope, ghg_category NULL, category, description,
              value numeric(20,6), unit, reporting_period, provenance, subject_type, subject_id,
              supplier_id NULL, source_ref, occurred_on date, deleted_at)
activity_evidence(organization_id, activity_id, evidence_id, linked_by_user_id, linked_at,
                  @@id(activity_id, evidence_id))
calculation(id, organization_id, activity_id, emission_factor_id, methodology,
            input_value, input_unit, normalized_value, normalized_unit, factor_value,
            factor_numerator_unit, factor_denominator_unit, factor_source, factor_version,
            gwp_set, scope, ghg_category NULL, reporting_period, result_value_tco2e,
            assumptions jsonb, steps jsonb, factor_selection_reasons jsonb,
            calculation_version, supersedes_id NULL, calculated_by_user_id, calculated_at,
            approved_by_user_id NULL, approved_at NULL)   -- IMMUTABLE (no UPDATE of inputs)
emission(id, organization_id, scope, ghg_category NULL, reporting_period, value_tco2e,
         calculation_count, method_summary, source_calculation_ids uuid[], computed_at,
         UNIQUE(organization_id, scope, ghg_category, reporting_period))   -- projection
```

- **All arithmetic is in `@trace/domain`** (decimal.js): `convert` (unit registry, exact,
  cross-dimension throws, no currency FX), `computeEmission` (normalise activity → apply
  factor → tonnes CO2e; stores `steps`), `recompute` (reproduces the stored result
  bit-for-bit), `selectEmissionFactor` (org-specific > library, geography/method/validity
  ranking, returns reasons), `summariseInventory` / `aggregateEmissions`.
- A `calculation` row stores **every input by value and by reference**, so
  `reproduceCalculation` re-runs the engine on the row alone. `recomputeCalculation`
  re-selects the factor and chains a new row (`supersedes_id`); the old row is frozen —
  a 2027 factor change never alters a 2026 result (Principle 35).
- Running a calculation also creates a `datapoint` (`provenance = calculated`,
  `calculation_id` set) and inherits the activity's evidence links.
- RLS (`FORCE`, `current_org()`) on `activity_data`, `activity_evidence`, `calculation`,
  `emission` — migration `0008_carbon_rls`. `emission_factor` is repository-scoped.
- Unit and unit-conversion tables from the earlier draft are **not** created: the
  `@trace/domain` unit registry is the single source of truth, exposed via
  `GET /emission-factors/units`.

### AI document intelligence (Phase 5)

```
ai_job(id, organization_id, capability, provider, model, prompt_version, input_type,
       input_ref, document_id NULL, status ai_job_status, output jsonb, confidence numeric(5,2),
       tokens_in, tokens_out, cost_eur numeric(12,6), latency_ms, reviewer_id NULL, error,
       created_at, completed_at)
document_extraction(id, organization_id, document_id UNIQUE, status extraction_status,
                    parser, parsed_text, page_count, truncated, classification jsonb,
                    ai_job_ids uuid[], candidate_count, error)
candidate_datapoint(id, organization_id, document_id, extraction_id NULL, ai_job_id NULL,
                    metric_key, label, value_numeric numeric(20,6), value_text, unit,
                    reporting_period, provenance_guess provenance, confidence numeric(5,2),
                    source_spans jsonb, rationale, status candidate_status,
                    promoted_datapoint_id NULL, reviewed_by_user_id NULL, reviewed_at,
                    review_note)
```

- **`@trace/ai`** provides `AIProvider` (`extractStructured`), a **Claude adapter**
  (forced tool use → JSON matching a hand-written schema → re-validated with Zod → thrown
  on failure) and a **deterministic dev stub** (`provider: 'stub'`, `model:
  'stub-heuristic@1'`) used when no `ANTHROPIC_API_KEY` is set. Prompts are versioned
  constants (`prompts/*.md` mirror them). `parseDocument` does deterministic
  pre-processing (text/csv native, PDF via `pdf-parse`).
- **Every model / stub call is an `ai_job` row**, written *before* the output is used
  (ADR-005). Recorded: capability, provider, model, prompt version, tokens, cost, latency,
  status, and the reviewer who later acts on it.
- The `@trace/db` orchestrator `runExtractionPipeline` runs parse → classify → extract and
  writes `candidate_datapoint` rows (status `pending`) with `source_spans` located in the
  parsed text. **Nothing here writes trusted data.**
- `promoteCandidate` (permission `candidate.review`) creates a `datapoint`
  (`label = human_reviewed`), ensures an `evidence` row backed by the source `document`
  (`status = extracted`), links datapoint ↔ evidence, and marks the candidate `promoted`.
  `rejectCandidate` marks it `rejected`. `ai_extracted → verified` automatically is never
  possible.
- RLS (`FORCE`, `current_org()`) on `ai_job`, `document_extraction`, `candidate_datapoint`
  — migration `0010_ai_rls`.

### Trust engine (Phase 6)

```
trust_score(id, organization_id, datapoint_id, subject_type, subject_id, metric_key,
            reporting_period NULL, value int, band trust_band, breakdown jsonb,
            model_version, inputs_digest, supersedes_id NULL, computed_by_user_id NULL,
            computed_at)                          -- immutable; current = no successor
data_quality_issue(id, organization_id, kind data_quality_issue_kind, severity issue_severity,
                   status issue_status, subject_type, subject_id, datapoint_id NULL,
                   metric_key NULL, reporting_period NULL, dedupe_key, title, detail,
                   facts jsonb, rules_version, first_detected_at, last_seen_at,
                   resolved_at NULL, resolved_by_user_id NULL, resolution_note NULL)
                   UNIQUE(organization_id, dedupe_key)
anomaly(id, organization_id, method anomaly_method, status anomaly_status, subject_type,
        subject_id, datapoint_id NULL, metric_key, point_key, reporting_period NULL,
        dedupe_key, observed_value numeric(30,6), expected_value numeric(30,6),
        score numeric(12,4), direction, explanations jsonb, detector_version, detected_at,
        last_seen_at, reviewed_by_user_id NULL, reviewed_at NULL, review_note NULL)
        UNIQUE(organization_id, dedupe_key)
quality_scan(id, organization_id, reporting_period NULL, datapoints_scored,
             avg_trust_score numeric(6,2) NULL, issues_opened, issues_resolved, issues_open,
             anomalies_found, model_version, rules_version, detector_version,
             ran_by_user_id NULL, started_at, completed_at, duration_ms)
```

- **`@trace/domain/trust`** holds all logic, pure and versioned: `scoreDatapoint`
  (`trust-model@1.0.0`) returns `{ value 0–100, band, breakdown[] }` where the breakdown is
  the additive per-dimension contribution table from
  [domain-model.md](domain-model.md#trace-trust-score-model) — it is stored so every score
  explains itself. `evaluateDatapointQuality` (`quality-rules@1.0.0`) runs 12 rules over a
  datapoint + its peers. `detectAnomalies` (`anomaly-detector@1.0.0`) — modified z-score
  (median/MAD) over a datapoint's history and its peer group, plus period-over-period step
  detection, each with factual candidate explanations.
- `trust_score` is **immutable and version-chained** (`supersedes_id`, like `calculation`);
  re-scoring with an identical `inputs_digest` is a no-op.
- `data_quality_issue` and `anomaly` upsert on a natural `dedupe_key` so **re-scans are
  idempotent**: an existing issue is refreshed (`last_seen_at`), an open issue no longer
  detected is **auto-resolved** with a note, `dismissed` is sticky, and a recurrence
  reopens an auto-resolved issue.
- Orchestrators in `@trace/db`: `scoreDatapointTrust`, `runQualityScan` (scores every
  in-scope datapoint, refreshes issues, detects anomalies, writes a `quality_scan`),
  `updateIssueStatus`, `updateAnomalyStatus`. Every mutation is hash-chain audit-logged; a
  full scan writes one summary `quality.scan_completed` entry.
- RLS (`FORCE`, `current_org()`) on `trust_score`, `data_quality_issue`, `anomaly`,
  `quality_scan` — migration `0012_trust_rls`.

## Indexing (initial)

- `(organization_id, <natural sort/filter col>)` composite on every high-traffic tenant
  table: `supplier(organization_id, name)`, `transaction(organization_id, occurred_on)`,
  `activity_data(organization_id, reporting_period)`,
  `calculation(organization_id, calculated_at)`,
  `emission(organization_id, scope, reporting_period)`,
  `datapoint(organization_id, subject_type, subject_id)`,
  `evidence(organization_id, verification_status)`.
- `emission_factor(source, source_ref, version)` unique; partial index
  `WHERE valid_to IS NULL` for current factors.
- `audit_log(organization_id, created_at)` and `audit_log(resource_type, resource_id)`.
- GIN on `jsonb` columns used for filtering (`metadata`, `assumptions`).
- `document(checksum_sha256)` for content-addressed dedupe.

## Lineage projection

`lineage_edge(organization_id, from_type, from_id, relation, to_type, to_id, created_at)`
is a **materialised projection** maintained by domain events (e.g. on calculation insert,
on datapoint↔evidence link). It powers the Evidence Graph and Evidence DNA UI without a
graph database. Source of truth remains the typed FK columns; `lineage_edge` is rebuildable
from them.

## GDPR-ready lifecycle

- Personal data columns are tagged in a data inventory (`docs/security.md`).
- **Erasure** = redaction workflow: personal fields tombstoned (`'[redacted]'` / null),
  lineage skeleton and non-personal evidence retained; an `audit_log` entry records the
  redaction. Evidence and calculations are never hard-deleted.
- **Export**: per-subject and per-organization structured export jobs.
- **Retention**: `retention_until` on documents; scheduled job enforces policy.
- **Region**: all storage and processing in an EU region.
