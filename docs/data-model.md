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

### Compliance (Phase 7)

```
-- global rule store (no organization_id; repository-scoped, NOT RLS'd — like emission_factor)
regulation(id, key, name, jurisdiction, description, notice, rule_store_version, loaded_at,
           UNIQUE(key, rule_store_version))
requirement(id, regulation_id, code, title, description, rule_store_version,
            UNIQUE(regulation_id, code))
disclosure(id, requirement_id, code, title, guidance, rule_store_version,
           UNIQUE(requirement_id, code, rule_store_version))
required_datapoint(id, disclosure_id, key, metric_key, unit NULL, cardinality, subject_scope,
                   aggregation, min_trust_score NULL, label, conditions jsonb, rule_store_version,
                   UNIQUE(key, rule_store_version))
evidence_requirement(id, disclosure_id, key, description, acceptable_types text[],
                     rule_store_version, UNIQUE(disclosure_id, key, rule_store_version))

-- tenant-owned results (RLS)
compliance_control(id, organization_id, requirement_id NULL, rule_store_version, key, name,
                   description, owner NULL, status control_status, last_tested_at NULL, note NULL,
                   created_at, updated_at, UNIQUE(organization_id, key))
compliance_mapping(id, organization_id, required_datapoint_id, disclosure_id, rule_store_version,
                   reporting_period NULL, status compliance_status, gap_reasons text[],
                   datapoint_ids uuid[], calculation_ids uuid[], evidence_ids uuid[],
                   resolved_value numeric(30,6) NULL, resolved_value_text NULL, trust_score int NULL,
                   confirmed bool, confirmed_by_user_id NULL, confirmed_at NULL, note NULL, computed_at,
                   UNIQUE(organization_id, required_datapoint_id, rule_store_version))
disclosure_status(id, organization_id, disclosure_id, rule_store_version, reporting_period NULL,
                  status compliance_status, required_total, satisfied, readiness_pct numeric(5,1),
                  computed_at, UNIQUE(organization_id, disclosure_id, rule_store_version))
compliance_run(id, organization_id, rule_store_version, reporting_period NULL, disclosures_evaluated,
               required_datapoints, mappings_written, readiness_pct numeric(5,1), ran_by_user_id NULL,
               started_at, completed_at NULL, duration_ms)
```

- **`@trace/compliance`** (pure, `@trace/shared` only) holds the versioned rule store as
  **frozen typed data** (`rules/esrs-2026-1.ts`, version `esrs@2026.1` — ESRS E1 climate)
  and the generic engine `evaluateRuleStore` / `evaluateRequiredDatapoint` +
  `rollUpDisclosureStatus` / `readinessPct`. Superseding a version inserts new rows and
  never mutates prior ones.
- Status is **objective, never "compliant"**: `not_started → data_available →
  evidence_available → mapping_complete`, with `review_required` an override when data
  exists but has a problem (`conflicting_data`, `expired_evidence`, `outdated_factor`,
  `unit_mismatch`, `low_trust_score`). `mapping_complete` also needs a human `confirmed`
  mapping and a Trust Score ≥ the required datapoint's threshold. `aggregation`
  (`single` | `sum` | `latest`) reconciles multiple candidates for one metric key.
- `@trace/db` orchestrators: `loadRuleStore` (idempotent upsert), `runComplianceEvaluation`
  (idempotent upsert on `[org, required_datapoint, version]`; preserves `confirmed`),
  `confirmMapping` (re-derives that mapping + its disclosure rollup), `upsertControl`. Every
  mutation is hash-chain audit-logged (`compliance.evaluated`, `compliance.mapping_confirmed`,
  `compliance.control_updated`).
- RLS (`FORCE`, `current_org()`) on `compliance_control`, `compliance_mapping`,
  `disclosure_status`, `compliance_run` — migration `0014_compliance_rls`. The rule-store
  tables are global and deliberately not RLS'd.

### Audit workspace (Phase 8)

```
audit(id, organization_id, name, scope, reporting_period NULL, period_start date NULL,
      period_end date NULL, status audit_status, lead_auditor_user_id NULL,
      external_auditor NULL, rule_store_version NULL, notes NULL, created_by_user_id,
      created_at, updated_at, closed_at NULL)
audit_simulation_run(id, organization_id, audit_id NULL, reporting_period NULL,
                     rule_store_version NULL, readiness_value int, readiness_band,
                     breakdown jsonb, issue_counts jsonb, findings_opened, findings_resolved,
                     findings_open, model_version, ran_by_user_id NULL, started_at,
                     completed_at NULL, duration_ms)
audit_finding(id, organization_id, audit_id NULL, simulation_run_id NULL, source finding_source,
              severity finding_severity, kind NULL, status finding_status, subject_type,
              subject_id, dedupe_key, title, detail, recommendation NULL, raised_by_user_id NULL,
              assigned_to_user_id NULL, due_on date NULL, first_detected_at, last_seen_at,
              resolved_by_user_id NULL, resolved_at NULL, resolution_note NULL, created_at,
              updated_at, UNIQUE(organization_id, dedupe_key))
audit_package(id, organization_id, audit_id NULL, reporting_period NULL, rule_store_version NULL,
              status audit_package_status, format, storage_key NULL, storage_driver NULL,
              size_bytes NULL, checksum_sha256 NULL, content_digest, manifest jsonb,
              readiness_value NULL, generated_by_user_id NULL, generated_at NULL, error NULL,
              created_at)
```

- **`@trace/domain/audit.assessReadiness`** (`audit-readiness@1.0.0`, pure) — a documented
  additive 0–100 score over seven dimensions (evidence verified 25, calculations
  reproducible 20 / approved 15, data quality 15, Trust level 10, compliance mapping 10,
  audit-trail integrity 5), returning a per-dimension breakdown and itemised issues, each
  carrying a `subjectType` / `subjectId`.
- `@trace/db` orchestrator `runAuditSimulation` gathers the tenant's evidence (verified /
  expired counts), calculations (`reproduceCalculation` per row, approval flag),
  data-quality issues, Trust Scores, compliance mappings and `verifyAuditChain`, runs the
  assessment, and **idempotently** upserts `audit_finding` rows (`source = simulation`,
  `dedupe_key = sim:<kind>|<subjectType>|<subjectId>`) — a re-run refreshes open findings,
  auto-resolves ones no longer detected, and leaves `accepted_risk` / `dismissed` alone.
  `source = manual` findings are raised by a person and never auto-resolved.
- `generateAuditPackage` assembles a canonical-JSON bundle (meta + disclaimer, organization,
  readiness breakdown, `summariseInventory`, evidence + verifications, calculations + steps +
  a live `reproduce` check, datapoints + lineage refs + Trust, compliance mappings + gaps,
  open findings, audit-log chain verification + head hash), writes it to object storage via
  an injected `putBytes`, and content-addresses it by SHA-256. `manifest` holds the counts.
- Other orchestrators: `createAudit` / `updateAudit`, `createFinding` / `updateFinding`,
  `evidenceReviewList`, `evidenceChain`. Every mutation is hash-chain audit-logged
  (`audit.simulation_completed`, `audit.finding_raised` / `_updated`,
  `audit.engagement_created` / `_updated`, `audit.package_generated`).
- RLS (`FORCE`, `current_org()`) on `audit`, `audit_finding`, `audit_simulation_run`,
  `audit_package` — migration `0016_audit_rls`.

### Command Center (Phase 9)

No new tables. `@trace/db.commandCenterOverview(db, organizationId, reportingPeriod?)` is a
**read-only aggregate**: it composes `inventorySummary` (per period, for the emissions
trend), `qualitySummary`, `complianceGaps`, and lean group-bys over `datapoint` (provenance
/ label mix), `audit_simulation_run` + `audit_finding`, `disclosure_status` +
`compliance_run`, `supplier` + `supplier_passport` + `supplier_request`, and `audit_log`
(recent activity) into one payload for `GET /command-center/overview` (`organization.read`).
No writes, no audit entry — every figure is read straight from a model row or an existing
engine.

### Ask TRACE (Phase 10)

```
ask_query(id, organization_id, question, intent, reporting_period NULL, answered bool,
          answer, record_count, citations jsonb, ai_job_ids uuid[], provider NULL, model NULL,
          tokens_in, tokens_out, cost_eur numeric(12,6), latency_ms, asked_by_user_id NULL,
          created_at)
```

- **`@trace/ai`** capability `nl_analytics`: `classifyAskIntent` (question → one of 11 fixed
  `ASK_INTENTS` + optional period, `ask/intent@1`), `composeAskAnswer` (question + numbered
  records → `{ answer, citedRefs }`, `ask/answer@1`). The model **never** authors a query
  (ADR-005, ADR-009).
- **`@trace/db.ask.ts`** holds the `RETRIEVALS` catalog — hand-written, tenant-scoped Prisma
  queries (via `inventorySummary`, `complianceGaps`, and direct group-bys / finds over
  `datapoint` / `calculation` / `emission_factor` / `trust_score` / `audit_finding` /
  `data_quality_issue` / `supplier`), each capped at 40 rows. `runAskQuery` = classify
  intent → run one retrieval → (if rows) compose answer → persist `ask_query` with the
  cited records (each carrying a UI `href`). Both model calls are `ai_job` rows
  (`capability = nl_analytics`, `input_type = query`, `input_ref = ask_query.id`), written
  before use. `answered = false` and no answer call when retrieval is empty or the intent
  is `unsupported`.
- RLS (`FORCE`, `current_org()`) on `ask_query` — migration `0018_ask_rls`.

### Procurement intelligence (Phase 11)

```
procurement_scenario(id, organization_id, name, description NULL, reporting_period NULL,
                     engine_version, baseline_tco2e numeric(20,4), projected_tco2e numeric(20,4),
                     delta_tco2e numeric(20,4), delta_pct numeric(8,2), inputs jsonb, result jsonb,
                     created_by_user_id, created_at)
```

- **`@trace/domain/procurement`** (pure, `procurement@1`): `compareSuppliers` returns per
  supplier a carbon **intensity** (tCO2e / €1,000 spend), emission & spend shares, an
  intensity ranking, an `attributionQuality` (`supplier_specific` | `spend_based` | `other`
  | `none`), flags, and deterministic reduction opportunities. `projectScenario` re-runs
  `computeEmission` on `ScenarioLineInput[]` with `ScenarioChange[]`
  (`activityMultiplier` / `factorValue` / `methodology` / `drop`) → baseline → projected →
  delta (exact, decimal.js). No AI.
- **`@trace/db/procurement.ts`** — no persisted comparison (it is derived on read):
  `supplierCarbonComparison` gathers `supplier` + `supplier_relationship.annual_spend` +
  attributed `datapoint`s (`subject_type = supplier`, `metric_key LIKE 'emission_%'`) +
  their `calculation.methodology` + `trust_score` + `supplier_passport`, then calls
  `compareSuppliers`. `scenarioLinesForSuppliers` builds lines from each supplier's largest
  attributed `calculation`. `runProcurementScenario` persists an **immutable**
  `procurement_scenario` (audit `procurement.scenario_run`).
- RLS (`FORCE`, `current_org()`) on `procurement_scenario` — migration `0020_procurement_rls`.

### Enterprise integrations (Phase 12)

```
integration(id, organization_id, kind, name, config jsonb, status, last_run_at NULL,
            created_by_user_id, created_at, updated_at)

integration_run(id, organization_id, integration_id NULL, kind, status, file_name NULL,
                file_checksum NULL, mapping jsonb, defaults jsonb,
                rows_total int, rows_valid int, rows_invalid int, rows_imported int,
                preview jsonb, errors jsonb, created_activity_ids uuid[],
                ran_by_user_id NULL, started_at, completed_at NULL, duration_ms int, error NULL)
```

- **`@trace/domain/integrations`** (pure): `parseDelimited(text, delimiter?)` — a
  dependency-free RFC-4180-ish CSV/TSV reader (quoted fields, `""` escape, embedded
  delimiters/newlines, CRLF/LF, BOM strip, blank records dropped, first non-empty record is
  the header) — plus `detectDelimiter`. `IntegrationAdapter` = `{ kind, label, targetFields(),
  sampleHeaders(), preview(input) }`, all pure. `CsvActivityAdapter` (`kind = csv_activity`)
  resolves each target field (constant > mapped column > default) and validates every row:
  required-missing, non-numeric / negative quantity, value not in an enum
  (`GHG_SCOPE` / subject type / `GHG_CATEGORY` / `PROVENANCE`), bad `YYYY-MM-DD` date,
  unit not in the TRACE unit registry (`isKnownUnit`), non-UUID `subject_id` / `supplier_id`.
  `preview` returns `{ kind, headers, rows: [{ line, raw, mapped|null, errors[] }],
  summary: { total, valid, invalid } }`. A `registry` maps `IntegrationKind → adapter`
  (`getIntegrationAdapter` throws on an unknown kind).
- **`@trace/db/integrations.ts`** — `previewImport(kind, text, mapping, defaults)` wraps the
  adapter (no transaction; wraps an unknown kind as `AppError.unprocessable`).
  `commitImport(db, args)` re-previews, creates the `integration_run` (`running`), then per
  **valid** mapped row `db.activityData.create` with
  `source_ref = import:<run>:<line>` and `provenance = mapped ?? 'estimated'`; per-row
  failures are caught into `errors[]`. Status is `failed` only when zero rows were written
  despite `valid > 0`, else `completed`; the run is updated with counts / `created_activity_ids`
  / timings, the connector's `last_run_at` is bumped, and one `integration.import_completed`
  audit entry is written. `createIntegration` / `updateIntegration` (audit-logged),
  `listIntegrations` (with run counts), `listIntegrationRuns`, `integrationRunById`.
- RLS (`FORCE`, `current_org()`) on `integration` and `integration_run` — migration
  `0022_integrations_rls`. `integration_run` is append-only in practice (created `running`,
  updated once to a terminal status); it is not version-chained.

### Enterprise access (Phase 13)

```
role(… , is_system boolean default false)   -- true for the 8 shipped roles; custom roles are false

api_key(id, organization_id, name, token_prefix UNIQUE, hashed_secret UNIQUE, last4,
        scopes text[], created_by_user_id, last_used_at NULL, expires_at NULL,
        revoked_at NULL, revoked_by_user_id NULL, created_at, updated_at)

webhook_endpoint(id, organization_id, url, description, events text[], secret,
                 status, created_by_user_id, last_success_at NULL, last_failure_at NULL,
                 consecutive_failures int, created_at, updated_at)

webhook_delivery(id, organization_id, endpoint_id, event, payload jsonb, status,
                 attempts int, max_attempts int, next_attempt_at NULL, last_attempt_at NULL,
                 response_status NULL, response_body NULL, error NULL, created_at, updated_at)
```

- **`@trace/domain/access`** (pure): API-key format `trk_<keyId>_<secret>` —
  `generateApiKey` / `parseApiKey` / `hashApiKeySecret` (sha256) /
  `apiKeySecretMatches` (constant-time) / `apiKeyState`. `API_KEY_SCOPES` are
  coarse tokens; `expandApiKeyScopes` turns them into a `Permission[]` that is
  always a subset of the catalog and **never** includes
  `API_KEY_FORBIDDEN_PERMISSIONS` (`apikey.manage`, `webhook.manage`,
  `role.manage`, `member.*`, `organization.update`, `platform.admin`).
  `webhook.ts`: `WEBHOOK_EVENTS` catalog, `webhookEventForAuditAction` (maps ~13
  audit actions → events), `signWebhookBody` / `verifyWebhookSignature`
  (`x-trace-signature: t=<ts>,v1=<hmac-sha256 of "ts.body">`, 5-min tolerance),
  `webhookNextAttemptAt` (0 / 30s / 2m / 10m / 30m / 2h), `WEBHOOK_MAX_ATTEMPTS = 6`.
  `role.ts`: `validateCustomRole`.
- **`@trace/db/access.ts`**: `createApiKey` (stores only `token_prefix` +
  `hashed_secret`; returns the token once, audit `apikey.created`),
  `revokeApiKey`, `listApiKeys` (never returns a secret), `authenticateApiKey`
  (global lookup by `token_prefix`, constant-time secret check, state check,
  `last_used_at` bumped at most once a minute). `createWebhookEndpoint` /
  `updateWebhookEndpoint` / `deleteWebhookEndpoint` / `rollWebhookSecret` /
  `listWebhookEndpoints`; `listWebhookDeliveries` / `webhookDeliveryById` /
  `retryWebhookDelivery` / `sendTestWebhook` (a `ping`). `dispatchDueWebhookDeliveries(prisma, { fetch })`
  is the platform sweep: for every `pending` delivery with `next_attempt_at <=
  now`, sign + POST, then `succeeded` / re-`pending` with backoff / `dead` (at
  `max_attempts`); an endpoint with 15 consecutive failures auto-`disabled`.
- **`writeAuditLog` fan-out**: after the hash-chain append, if
  `webhookEventForAuditAction(action)` is non-null and the org has `active`
  endpoints subscribed to it, one `webhook_delivery` per endpoint is created **in
  the same transaction** (`payload` = the signed envelope from
  `buildWebhookEventPayload`).
- RLS: `webhook_endpoint` is `FORCE` `current_org()` (migration
  `0024_access_rls`). `api_key` and `webhook_delivery` are **not** RLS'd — the
  first is the credential that establishes org context (like `session`), the
  second is a cross-tenant operational log swept by the dispatcher (like
  `audit_log`); both carry `organization_id` and every read path filters on it.

### Enterprise identity & governance (Phase 13b)

```
organization(… , require_mfa boolean default false, legal_hold boolean default false)

user_mfa(user_id PK, secret, recovery_codes text[], confirmed_at NULL, last_used_at NULL,
         created_at, updated_at)          -- user-keyed, NOT RLS'd (like session)

export_job(id, organization_id, status, reporting_period NULL, requested_by_user_id,
           format, storage_key NULL, sha256 NULL, size_bytes NULL, section_counts jsonb,
           total_records int, manifest jsonb NULL, error NULL, started_at NULL,
           completed_at NULL, expires_at NULL, created_at)

retention_policy(id, organization_id, target, age_days int, enabled bool,
                 created_by_user_id, last_run_at NULL, created_at, updated_at,
                 UNIQUE(organization_id, target))

retention_run(id, organization_id, policy_id NULL, target, mode (dry_run|apply),
              age_days int, cutoff, matched int, deleted int, ran_by_user_id NULL,
              started_at, completed_at NULL, duration_ms int, error NULL)
```

- **`@trace/domain/access`** (pure): `totp.ts` — `base32Encode/Decode`,
  `generateTotpSecret` (20 bytes), `totpCodeAt` (SHA-1 HOTP, 6 digits, 30s step),
  `verifyTotp` (±1-step drift, constant-time), `otpauthUrl`,
  `generateRecoveryCodes` (10 × `xxxxx-xxxxx`) + `hashRecoveryCode`
  (HMAC-SHA256). `export-bundle.ts` — `EXPORT_SECTIONS` (24), `buildExportManifest`,
  `EXPORT_TTL_HOURS = 168`. `retention.ts` — `RETENTION_TARGETS` (`ai_job`,
  `webhook_delivery`, `quality_scan`, `audit_simulation_run`, `ask_query`,
  `integration_run`, `export_job` — each with a hard minimum age; **no** lineage
  or audit-log target), `validateRetentionPolicy`, `retentionCutoff`.
- **`@trace/db/mfa.ts`**: `beginMfaEnrollment` (unconfirmed secret),
  `confirmMfaEnrollment` (verify a live code → set `confirmed_at`, store hashed
  recovery codes, `user.mfa_enabled = true`, audit `mfa.enrolled`),
  `verifyMfaChallenge` (TOTP → bump `last_used_at`; else a recovery-code hash →
  remove it from the array), `disableMfa` (requires a code; audit
  `mfa.disabled`), `resolveMfaRequirement` (`{ mustSatisfy: enrolled ||
  org.require_mfa, enrolled, orgMandates }`).
- **`@trace/db/governance.ts`**: `runExport` mirrors the Phase-8 audit package —
  read every section (`serializeRow` turns Date → ISO, Decimal → string, Buffer
  → base64), `canonicalJson`, sha256, `deps.putBytes('exports/<org>/<sha256>/export.json')`,
  job → `ready` with `manifest` + `section_counts` + `expires_at`; audit
  `data.exported`. `expireStaleExports` flips `ready → expired` past the TTL and
  drops the key. `upsertRetentionPolicy` / `deleteRetentionPolicy` /
  `listRetentionPolicies` / `listRetentionRuns`. `runRetention` — per enabled
  policy: `cutoff = now − ageDays`, `count` (and `deleteMany` when `mode =
  apply`) scoped to the tenant; `apply` throws `retention.legal_hold` when
  `organization.legal_hold`; one `retention_run` per policy + one
  `retention.run` audit entry. `activeOrganizationIds` feeds the worker's sweep.
- RLS: `export_job` / `retention_policy` / `retention_run` are `FORCE`
  `current_org()` (migration `0026_governance_rls`). `user_mfa` is not RLS'd —
  identity, keyed on the user, like `session`.

### Usage metering & plan quotas (Phase 13c)

```
plan(key PK, name, quotas jsonb, soft_warn_pct int, is_default bool)   -- global catalogue

subscription(organization_id PK, plan_key -> plan.key, status default 'active',
             current_period text, started_at, created_at, updated_at)

usage_counter(id, organization_id, period text, metric text, value int,
              last_event_at NULL, created_at, updated_at,
              UNIQUE(organization_id, period, metric))

usage_event(id, organization_id, period text, metric text, quantity int,
            route NULL, occurred_at)
```

- **`@trace/domain/access`** (pure): `metering.ts` — `USAGE_METRICS`
  (`api_request`, `ai_job`, `calculation_run`, `export_job`, `seats` [gauge]),
  `ENFORCED_METRICS` (the three that 429), `PLAN_TIERS` (`free` / `growth` /
  `enterprise` — `{ quotas: { metric: monthlyLimit }, softWarnPct }`; a metric
  absent from `quotas` is unlimited), `billingPeriodKey(at)` → `YYYY-MM` UTC,
  `billingPeriodBounds`, `evaluateMetric` / `evaluateUsage` (`used`, `quota`,
  `pct`, `state` ∈ `ok`/`warn`/`over`), `wouldExceedQuota`, `crossedSoftWarn`
  (`prev < threshold ≤ next`). `audit-egress.ts` — `normalizeAuditFilter`
  (regex-guards `actionPrefix` / `resourceType`, parses dates — a filter can
  never be an injection vector), `toNdjson`, `AUDIT_EXPORT_MAX_ROWS = 20 000`.
- **`@trace/db/metering.ts`**: `loadPlans` (idempotent upsert from `PLAN_TIERS`
  — global). `ensureSubscription` (get-or-create; rolls `current_period` to the
  live period if stale). `setPlan` (validates the key; upserts; audit
  `billing.plan_changed`). `recordUsage(db, {organizationId, metric, quantity=1,
  route?})` — `usage_counter` upsert `value += quantity`; a `usage_event` row for
  every metric except `api_request`; if the write **crosses** the plan's
  soft-warn threshold, one `usage.threshold_reached` audit entry (which fans out
  to the webhook of the same name). `recordApiRequest(prisma, orgId)` — the raw
  hot-path counter bump used by the API interceptor. `currentUsage` (subscription
  + plan + `evaluateUsage` over the period's counters, with `seats` as a live
  `membership` count). `checkQuota(db, org, metric)` → `{ allowed, state, used,
  quota }` for the `QuotaGuard`.
- **`@trace/db/audit.ts`**: `queryAuditLog(db, org, filter, {limit, cursor})`
  (newest-first, cursor-paged) and `exportAuditLog(db, org, filter)` →
  `{ ndjson, rows, truncated }` (oldest-first so the file is chain-verifiable;
  capped at `AUDIT_EXPORT_MAX_ROWS`).
- API: a global `UsageInterceptor` records `api_request` (and the
  `@Metered(metric)` increment) fire-and-forget on every 2xx with an active org;
  a `QuotaGuard` blocks `@Metered` routes whose metric is enforced with
  `429 quota.exceeded`. `provisionOrganization` calls `loadPlans` +
  `ensureSubscription`.
- RLS: `subscription` / `usage_counter` / `usage_event` are `FORCE`
  `current_org()` (migration `0028_metering_rls`); the interceptor and the worker
  roll-forward open `withOrgContext`. `plan` is the global catalogue, not RLS'd.
  `usage_event` is a Phase-13b retention target (min 30 days).

### Audit-log streaming + monitoring (Phase 13d)

```
audit_stream(id, organization_id, name, url, secret, filters jsonb, status,
             cursor text NULL, created_by_user_id, last_delivery_at NULL,
             last_error NULL, consecutive_failures int, created_at, updated_at)

audit_stream_delivery(id, organization_id, stream_id, from_cursor NULL, to_cursor,
                      count int, status, attempts int, max_attempts int,
                      next_attempt_at NULL, last_attempt_at NULL,
                      response_status NULL, error NULL, created_at, updated_at)

component_heartbeat(component PK, beat_at, meta jsonb)   -- global, no org scope
```

- **`@trace/domain/access`** (pure): `audit-stream.ts` — `AuditStreamFilter`
  `{ actionPrefixes?, resourceTypes? }`, `normalizeAuditStreamFilter`
  (regex-guards each — `/^[a-z][a-z0-9_.]{0,60}$/` / `/^[a-z][a-z0-9_]{0,60}$/`),
  `matchesAuditStream(filter, {action, resourceType})` (prefixes OR-match,
  resourceTypes AND-restrict, empty = match all), `buildAuditStreamBatch`
  (`{ stream:'audit-log', streamId, organizationId, deliveryId, sentAt, count,
  entries[] }`), `auditStreamNextAttemptAt` (0 / 15s / 1m / 5m / 15m / 1h / 3h /
  6h), `AUDIT_STREAM_BATCH_SIZE = 200`, `AUDIT_STREAM_MAX_ATTEMPTS = 8`,
  `AUDIT_STREAM_AUTO_PAUSE_THRESHOLD = 20`. `prometheus.ts` — `renderPrometheus`
  (one `# HELP`/`# TYPE` per name, escaped label values, non-finite → 0) +
  `PROMETHEUS_CONTENT_TYPE`. `health.ts` — `rollUpHealth` (down → unhealthy;
  degraded → degraded; else healthy), `buildHealthReport`, `heartbeatStatus`
  (`up` ≤ 120s, `degraded` ≤ 600s, else `down`).
- **`@trace/db/audit-stream.ts`**: `createAuditStream` (https URL, initial
  `cursor` = current `audit_log` head so history is **not** back-filled; audit
  `audit_stream.created`), `updateAuditStream` (re-activation clears the failure
  counter), `deleteAuditStream`, `rotateAuditStreamSecret`, `listAuditStreams`
  (no secret), `listAuditStreamDeliveries`, `sendTestAuditStream` (a `pending`
  delivery with `from_cursor = '__test__'`). `dispatchOrgAuditStreams(db, {fetch,
  now?, batchSize?})` — for each `active` stream: (1) if a `pending`/`failed`
  delivery is due, re-read its window and re-POST; (2) else read the next
  `audit_log` window after `cursor` (order `[createdAt, id]`, `take batchSize`),
  filter with `matchesAuditStream`; no matches → advance `cursor`, no delivery
  row; matches → create a delivery + POST a `signWebhookBody`-signed batch
  (`x-trace-signature`). On 2xx → `cursor = to_cursor` (unless a test), reset
  failures, `last_delivery_at`. On failure → delivery `failed` w/
  `next_attempt_at` (or `dead` at `max_attempts`, and the `cursor` is advanced
  past a dead batch so the stream cannot wedge), `consecutive_failures++`,
  auto-`paused` at 20. `writeHeartbeat` / `readHeartbeat` on `component_heartbeat`.
- **`@trace/db/ops.ts`**: `orgStats(db, org, now?)` — per-tenant counts
  (members / suppliers / datapoints / calculations / evidence / audit entries /
  open findings / webhook endpoints / audit streams / api-requests &amp; ai-jobs
  this period) + the worker-heartbeat status. `platformMetrics(prisma, now?)` →
  `MetricSample[]` — only tables reachable without an org context
  (`organization`, `user`, `audit_log`, `webhook_delivery`,
  `audit_stream_delivery`, `subscription` group-by plan) + the worker
  heartbeat age.
- RLS: `audit_stream` is `FORCE` `current_org()` (migration
  `0030_audit_stream_rls`); the worker dispatch enumerates orgs via
  `activeOrganizationIds` + `withOrgContext`. `audit_stream_delivery` is a
  system-written log — not RLS'd (like `webhook_delivery`), read paths filter
  `organization_id`. `component_heartbeat` has no org scope.

### Single sign-on — OpenID Connect (Phase 13e)

```
user(… , external_id text NULL)   -- last IdP `sub` seen; SsoLink is authoritative

identity_provider(id, organization_id UNIQUE, protocol default 'oidc', enabled,
                  issuer, client_id, client_secret, authorization_endpoint,
                  token_endpoint, jwks_uri, scopes, role_mapping jsonb,
                  allowed_email_domains text[], created_by_user_id, created_at, updated_at)

sso_login_request(id, organization_id, state UNIQUE, nonce, pkce_verifier,
                  redirect_after NULL, expires_at, consumed_at NULL, created_at)
                  -- NOT RLS'd (looked up by `state` pre-auth, like magic_link_token)

sso_link(id, organization_id, user_id, identity_provider_id, external_id,
         last_login_at, created_at,
         UNIQUE(identity_provider_id, external_id), UNIQUE(identity_provider_id, user_id))
```

- **`@trace/domain/access/oidc.ts`** (pure): `generatePkce()` → `{verifier,
  challenge, method:'S256'}` (`challenge = base64url(sha256(verifier))`),
  `pkceChallengeFor`, `randomUrlToken(bytes=32)` (state / nonce),
  `buildAuthorizationUrl` (`response_type=code`, `code_challenge_method=S256`,
  `state`, `nonce`), `verifyIdToken(token, {jwks, issuer, audience, nonce, now?})`
  → `{ok, claims} | {ok:false, reason}` — **RS256 only** (`alg:none` / `HS*`
  rejected), signature via `crypto.createPublicKey({key: jwk, format:'jwk'})` +
  `crypto.verify('RSA-SHA256', …)`, then `iss` / `aud` (array-aware) / `exp`
  (±120 s skew) / `nbf` / `sub` / `nonce`. `mapClaimsToRoleKeys(claims, mapping)`
  — `OidcRoleMapping {defaultRoles, emailDomainRoles?, groupClaim?, groupRoles?}`
  → de-duplicated role-key list. `emailDomainAllowed(email, allowedDomains)`
  (empty list = any). `OIDC_LOGIN_TTL_SECONDS = 600`.
- **`@trace/db/sso.ts`**: `upsertIdentityProvider` (https endpoints; every mapped
  role must exist for the org; `clientSecret` optional on update — reuses the
  stored one; audit `sso.provider_configured` / `_updated`), `getIdentityProvider`
  (drops `client_secret`, adds `linkedMembers`), `deleteIdentityProvider`.
  `beginSsoLogin(prisma, {orgSlug, redirectUri, redirectAfter?})` — resolves the
  org by slug, reads its provider (must be `enabled`) in `withOrgContext`, mints
  PKCE + `state` + `nonce`, writes an `sso_login_request`, returns the
  authorization URL. `completeSsoLogin(prisma, deps, {state, code, redirectUri})`
  — loads + consumes the `sso_login_request` (single-use, TTL), reads the
  provider, `deps.exchangeCode(...)` → `id_token`, `deps.fetchJwks(jwksUri)`,
  `verifyIdToken`, `emailDomainAllowed`, `prisma.user.upsert({email})` with
  `external_id = sub`, then in `withOrgContext`: `sso_link.upsert` on `(provider,
  external_id)` + `membership.create` with `mapClaimsToRoleKeys` roles when none
  exists (re-activate if suspended); audit `sso.member_provisioned` /
  `sso.login`. Returns `{userId, organizationId, roleKeys, provisioned,
  redirectAfter}`. `pruneSsoLoginRequests` (worker housekeeping).
- API: `SsoAuthController` (`GET /auth/sso/:slug/start` → 302; `GET
  /auth/sso/:slug/callback` → `completeSsoLogin` → `AuthService.createSession` →
  302; `@Public()` + `@MfaExempt()`; failures → `/login?sso_error=`; real
  `exchangeCode` / `fetchJwks` via global `fetch`). `SsoConfigController`
  (`GET/PUT/DELETE /settings/sso`, `POST /settings/sso/discover` —
  `security.manage`).
- RLS: `identity_provider` + `sso_link` are `FORCE` `current_org()` (migration
  `0032_sso_rls`); the pre-auth flow resolves the org first, then
  `withOrgContext`. `sso_login_request` is not RLS'd (state lookup before any
  context exists).

### Single sign-on — SAML 2.0 (Phase 13f)

```
saml_provider(id, organization_id UNIQUE, enabled, idp_entity_id, sso_url,
              certificates text[], email_attribute NULL, name_attribute NULL,
              groups_attribute NULL, want_assertions_signed default true,
              role_mapping jsonb, allowed_email_domains text[],
              created_by_user_id, created_at, updated_at)
              -- only the IdP's PUBLIC signing certs are stored; no secret

saml_login_request(id, organization_id, saml_request_id UNIQUE, relay_state UNIQUE,
                   redirect_after NULL, expires_at, consumed_at NULL, created_at)
                   -- NOT RLS'd (looked up by `relay_state` at the ACS, pre-auth)

saml_link(id, organization_id, user_id, saml_provider_id, name_id,
          last_login_at, created_at,
          UNIQUE(saml_provider_id, name_id), UNIQUE(saml_provider_id, user_id))
```

- **`@trace/domain/access/saml.ts`** (pure, + `xml-crypto` / `@xmldom/xmldom` —
  pure computation, no I/O): `generateSamlId()` (`_` + 40 hex),
  `generateRelayState()`, `buildAuthnRequestXml` + `buildRedirectBindingUrl`
  (SP-initiated HTTP-Redirect binding: `SAMLRequest = base64(DEFLATE(xml))`, raw
  deflate; the request is **not** signed), `buildSpMetadataXml`,
  `normalizeCertificatePem` (wrap a bare base64 body in PEM armour),
  `verifySamlResponse(xml, {certificatesPem, spEntityId, acsUrl,
  expectedInResponseTo, idpEntityId, wantAssertionsSigned?, now?, clockSkewSeconds?})`
  → `{ok, nameId, nameIdFormat, sessionIndex, attributes} | {ok:false, reason}`.
  The signature is verified by `xml-crypto` (`SignedXml`, `getCertFromKeyInfo` forced
  to `null` so a document-embedded cert is never trusted); **identity is read only
  from `getSignedReferences()`** — the canonicalised bytes the library reports as
  covered by a verified signature — which structurally defeats XML-signature-
  wrapping. On top: exactly one `<saml:Assertion>` (0 / >1 / `EncryptedAssertion`
  → reject), every `<ds:Signature>` must be a direct child of the Response or that
  Assertion, `SignatureMethod` / `DigestMethod` must be RSA-SHA-256/384/512 (SHA-1
  rejected before the crypto call), assertion-level signature required unless
  `wantAssertionsSigned` is false; then `Issuer` == `idpEntityId`, Status ==
  `...:status:Success`, bearer `SubjectConfirmationData` `Recipient` == `acsUrl` /
  `InResponseTo` == `expectedInResponseTo` / `NotOnOrAfter` in the future (±120 s),
  `Conditions` `NotBefore` / `NotOnOrAfter` window, `AudienceRestriction` contains
  `spEntityId` (none → reject), response `Destination` / `InResponseTo` when
  present. `extractSamlIdentity(data, mapping)` — email / name / groups from the
  configured attribute names, falling back to well-known attribute URIs then (for
  email) the NameID. `mapSamlToRoleKeys(email, groups, roleMapping)` reuses the
  13e `OidcRoleMapping` engine. `SAML_LOGIN_TTL_SECONDS = 600`.
- **`@trace/db/saml.ts`**: `upsertSamlProvider` (SSO URL https; each certificate
  parses as an X.509 cert **or** a public key; every mapped role must exist for
  the org; audit `saml.provider_configured` / `_updated`), `getSamlProvider`
  (adds `linkedMembers`), `deleteSamlProvider`. `beginSamlLogin(prisma, {orgSlug,
  acsUrl, spEntityId, redirectAfter?})` — resolves the org by slug, reads its
  provider (must be `enabled`) in `withOrgContext`, mints `saml_request_id` +
  `relay_state`, writes a `saml_login_request`, returns `{redirectUrl}`.
  `completeSamlLogin(prisma, {samlResponse, relayState, acsUrl, spEntityId})` —
  loads + consumes the `saml_login_request` (single-use, TTL), reads the provider,
  base64-decodes + `verifySamlResponse`, `extractSamlIdentity`,
  `emailDomainAllowed`, `prisma.user.upsert({email})` with `external_id = NameID`,
  then in `withOrgContext`: `saml_link.upsert` on `(provider, name_id)` +
  `membership.create` with `mapSamlToRoleKeys` roles when none exists (re-activate
  if suspended); audit `saml.member_provisioned` / `saml.login`. Returns
  `{userId, organizationId, roleKeys, provisioned, redirectAfter}`.
  `pruneSamlLoginRequests` (worker housekeeping).
- API: `SamlAuthController` (`GET /auth/saml/:slug/start` → 302; `POST
  /auth/saml/:slug/acs` → `completeSamlLogin` → `AuthService.createSession` →
  302; `GET /auth/saml/:slug/metadata` → SP metadata XML; all `@Public()` +
  `@MfaExempt()`, the ACS CSRF-exempt via `@Public()`; failures →
  `/login?sso_error=`). `SamlConfigController` (`GET/PUT/DELETE /settings/saml` —
  `security.manage`).
- RLS: `saml_provider` + `saml_link` are `FORCE` `current_org()` (migration
  `0034_saml_rls`). `saml_login_request` is not RLS'd (relay-state lookup at the
  ACS before any context exists).

### SCIM 2.0 provisioning (Phase 13g)

```
scim_config(id, organization_id UNIQUE, enabled, token_hash NULL, token_prefix NULL,
            default_roles text[], group_role_mapping jsonb,
            last_request_at NULL, created_by_user_id, created_at, updated_at)
            -- token_hash = sha256 of the bearer token (shown once)

scim_user(id, organization_id, user_id, external_id NULL, user_name, active,
          given_name NULL, family_name NULL, display_name NULL, raw jsonb,
          created_at, updated_at,
          UNIQUE(organization_id, user_name), UNIQUE(organization_id, external_id),
          UNIQUE(organization_id, user_id))
          -- the provisioning projection of a `membership`; active ⇄ suspended

scim_group(id, organization_id, external_id NULL, display_name, raw jsonb,
           created_at, updated_at,
           UNIQUE(organization_id, display_name), UNIQUE(organization_id, external_id))

scim_group_member(scim_group_id, scim_user_id, PRIMARY KEY(scim_group_id, scim_user_id))
                  -- pure join, no organization_id (like membership_role) — not RLS'd
```

- **`@trace/domain/access/scim.ts`** (pure): `generateScimToken()` →
  `{token: 'scim_'+…, hash, prefix}` + `scimTokenMatches` (constant-time),
  `parseScimUser` / `parseScimGroup` (from a create / PUT body; primary email =
  first `emails[].primary`, else `emails[0]`, else the userName if it looks like
  an email), `normalizeScimPatch` (PatchOp envelope → `{op, path?, value?}[]`,
  `op` lower-cased ∈ add/remove/replace) + `applyScimUserPatch` /
  `applyScimGroupPatch` (plain-model appliers — `active`, `userName`,
  `displayName`, `name.givenName` / `name.familyName`, `emails`, `externalId`;
  for groups the bare `members` array and the `members[value eq "id"]` selector;
  unknown paths ignored), `scimUserResource` / `scimGroupResource` /
  `scimListResponse` / `scimError` (RFC 7644 shapes + `meta.location`),
  `parseScimFilter` (`attribute eq "value"` only — richer grammar → `null`),
  `scimPaginationParams` (`startIndex` ≥ 1, `count` clamped to `[0, 200]`,
  default 100), `resolveScimRoleKeys(defaultRoles, groupRoleMapping, groupKeys)`
  and `scimManagedRoleKeys` (the union SCIM is allowed to touch), and the
  `ServiceProviderConfig` / `ResourceTypes` / `Schemas` documents.
- **`@trace/db/scim.ts`**: `upsertScimConfig` (every mapped role must exist for
  the org; audit `scim.config_created` / `_updated`), `getScimConfig` (drops
  `token_hash`, adds `hasToken` / counts), `rotateScimToken` (new sha256 + prefix;
  audit `scim.token_rotated`), `deleteScimConfig` (also drops `scim_user` /
  `scim_group`; memberships kept). `authenticateScim(prisma, {orgSlug,
  bearerToken})` — resolves the org by slug, reads `scim_config` in
  `withOrgContext`, constant-time token compare, throttled `last_request_at`
  touch. `scim{List,Get,Create,Replace,Patch,Delete}User` /
  `scim{List,Get,Create,Replace,Patch,Delete}Group` + `scimAdminOverview`. A
  create upserts the platform `user` by email, find-or-creates the `membership`
  (active / suspended from `active`), writes the `scim_user`, then
  `reconcileMemberRoles`. A PATCH `active:false` (or PUT, or DELETE) suspends the
  membership; DELETE also removes the `scim_user` row and strips the managed
  roles. Group membership changes reconcile every affected member.
  `reconcileMemberRoles` computes the wanted role set
  (`resolveScimRoleKeys`) and reconciles `membership_role` **only within the
  managed set** — roles assigned by hand are never removed. Every mutation is
  audit-logged (`scim.user_provisioned` / `_updated` / `_reactivated` /
  `_deprovisioned`, `scim.group_created` / `_updated` / `_deleted`).
- API: `/scim/v2/:orgSlug/{Users,Groups}` full CRUD + `PATCH` + discovery
  (`ServiceProviderConfig` / `ResourceTypes` / `Schemas`), all `@Public()` +
  `ScimAuthGuard` (bearer) + `ScimExceptionFilter` (RFC 7644 `Error`) +
  `application/scim+json`. `ScimConfigController` (`GET` / `PUT` / `POST /token` /
  `DELETE /settings/scim` — `security.manage`). `AuthGuard`'s API-key path only
  engages for `trk_` tokens; `main.ts` registers the JSON body parser for
  `application/scim+json`.
- RLS: `scim_config` + `scim_user` + `scim_group` are `FORCE` `current_org()`
  (migration `0036_scim_rls`); the pre-auth flow resolves the org from the URL
  slug, verifies the token, then `withOrgContext`. `scim_group_member` has no
  `organization_id` (like `membership_role`) and is not RLS'd — read only through
  the RLS'd parents.

### Billing-provider integration (Phase 13h)

```
billing_config(id, organization_id UNIQUE, provider default 'stripe', enabled,
               publishable_key NULL, secret_key NULL, webhook_secret NULL,
               price_to_plan jsonb, customer_id NULL, subscription_ref NULL,
               created_by_user_id, created_at, updated_at)
               -- secret_key + webhook_secret stored plaintext (encrypt at rest)

billing_event(id, organization_id, provider_event_id UNIQUE, type, status,
              outcome jsonb, error NULL, received_at)
              -- idempotency ledger; not RLS'd (like webhook_delivery)

billing_checkout(id, organization_id, plan_key, provider_ref NULL,
                 status default 'pending', created_by_user_id,
                 created_at, completed_at NULL)   -- not RLS'd
```

- **`@trace/domain/access/billing.ts`** (pure): `signBillingPayload(secret, ts,
  body)` / `verifyBillingSignature(secret, header, body, now?)` — `t=<unix>,v1=
  <hmac-sha256(`<ts>.<body>`)>`, 300 s tolerance, constant-time (the same scheme
  as the Phase-13a outbound webhooks, under `x-trace-billing-signature`).
  `generateBillingWebhookSecret()` → `{secret: 'whsec_'+…}`.
  `normalizeBillingEvent(raw)` — a Stripe event object →
  `{id, type ('checkout.completed' | 'subscription.updated' | 'subscription.canceled'
  | 'payment.failed' | 'unknown'), createdAt, priceId, customerId, subscriptionId,
  sessionId, clientReferenceId, requestedPlanKey (from `metadata.trace_plan`),
  providerStatus, raw}` | null. `resolvePlanForPrice(priceId, priceToPlan)` /
  `priceForPlan(planKey, priceToPlan)` (reverse). `billingEventOutcome(event,
  priceToPlan)` → `{planKey: string | null, status: 'active' | 'past_due' |
  'canceled' | null, reason}` — checkout → `requestedPlanKey` else the mapped
  price (`status: active`); `subscription.updated` → mapped price's plan + a
  provider-status mapping, a `canceled` status → `BILLING_FALLBACK_PLAN` (=
  `free`); `subscription.canceled` → free + `canceled`; `payment.failed` →
  `past_due`, no plan change. `invalidPlanKeysInMap(map)`.
- **`@trace/db/billing.ts`**: `BillingProviderAdapter` (injected) —
  `createCheckoutSession` / `createPortalSession`. `upsertBillingConfig` (every
  mapped value must be a known plan key; `secretKey` / `webhookSecret` omitted →
  keep stored, `''` → clear; first `enabled` with no secret mints one and returns
  it once; audit `billing.provider_configured` / `_updated`), `getBillingConfig`
  (`hasSecretKey` / `hasWebhookSecret` — never the values), `rotateBillingWebhookSecret`,
  `deleteBillingConfig`. `startCheckout(db, {adapter}, {organizationId, planKey,
  successUrl, cancelUrl, …})` — requires `enabled` + `secret_key` + a price mapped
  to `planKey`; writes a `billing_checkout` (pending), calls the adapter, stores
  `provider_ref` + the returned `customer_id`; audit `billing.checkout_started`.
  `billingPortalUrl(db, {adapter}, {organizationId, returnUrl})` — needs
  `customer_id`. `handleBillingWebhook(prisma, {orgSlug, signatureHeader, rawBody,
  requestId})` — resolves the org by slug, reads `billing_config` in
  `withOrgContext`, `verifyBillingSignature` (→ `billing.bad_signature` 401),
  `JSON.parse` + `normalizeBillingEvent` (→ `billing.bad_event` 422),
  **dedupe on `provider_event_id`** (seen → `{handled:false, duplicate:true}`),
  then `ensureSubscription` + `setPlan` (when `planKey`, actor = the config
  creator) + `subscription.status` update + record `customer_id` /
  `subscription_ref` + complete the matching `billing_checkout` + write the
  `billing_event` row + audit `billing.webhook_processed`. `billingOverview`
  (config + subscription + last 20 events). `expireStaleCheckouts(prisma,
  maxAgeMs=1h)` (worker housekeeping).
- API: `BillingController` — `POST /billing/checkout` + `GET /billing/portal`
  (session-authed, `billing.manage`, return `{url}` for the SPA), `POST
  /billing/webhook/:orgSlug` (`@Public()` + `@MfaExempt()`, reads `req.rawBody`
  — `main.ts` sets `rawBody: true`). `BillingConfigController`
  (`GET` / `PUT` / `POST /webhook-secret` / `DELETE /settings/billing` —
  `billing.manage`). `stripe-adapter.ts` — the real `fetch`-based adapter
  (`/v1/checkout/sessions`, `/v1/billing_portal/sessions`, form-encoded, `Bearer`
  secret key, 8 s timeout), used only when a live secret key is configured.
- RLS: `billing_config` is `FORCE` `current_org()` (migration `0038_billing_rls`);
  the webhook handler resolves the org from the URL slug first, then
  `withOrgContext`. `billing_event` / `billing_checkout` carry `organization_id`,
  are not RLS'd (system logs, swept cross-tenant by the worker).

### Carbon Twin — supply-chain graph (Phase 14a)

```
supply_chain_edge(id, organization_id, from_supplier_id, to_supplier_id NULL,
                  to_label, relationship NULL, tier NULL, source default 'manual',
                  created_by_user_id, created_at, updated_at,
                  UNIQUE(organization_id, from_supplier_id, to_label))
                  -- a tenant-declared upstream link; to_supplier_id set when the
                  -- upstream party is itself a `supplier` row, else to_label only

carbon_graph_snapshot(id, organization_id, version, builder_version,
                      reporting_period NULL, data jsonb, node_count, edge_count,
                      total_tco2e numeric(20,6), attributed_pct, hotspot_count,
                      computed_by_user_id NULL, computed_at,
                      UNIQUE(organization_id, version))
                      -- immutable; `data` = the domain CarbonGraph + HotspotReport
```

- **`@trace/domain/network/graph.ts`** (pure): `buildCarbonGraph(nodeInputs,
  edgeInputs, {rootId?})` → `CarbonGraph { builderVersion, rootId, nodes[], edges[],
  totals, cycleWarnings }`. Each `CarbonGraphNode` carries `directTco2e`,
  `upstreamTco2e` (= Σ `directTco2e` of its **unique** descendants — DAG-safe,
  `MAX_GRAPH_DEPTH = 8`, back-edges dropped into `cycleWarnings`), `totalTco2e`,
  `intensityTco2ePerKEur`, `depth` (BFS from root), `childIds` / `parentIds`. Each
  `CarbonGraphEdge` gets `tco2e` (root→supplier = supplier's total; supplier→supplier
  = the upstream node's total if > 0, else null → `kind: 'declared'`) and `share`
  of the root total. `totals` = `{nodes, suppliers, edges, totalTco2e,
  supplierSpecificTco2e, spendBasedTco2e, unattributedSuppliers, attributedPct,
  evidenceBackedPct (direct-weighted), maxDepth}`. `rankHotspots(graph,
  {coverageTarget = 0.8})` → `HotspotReport { coverageTarget, hotspotCount,
  cumulativeSharePctAtCut, medianIntensityTco2ePerKEur, nodes[] }` — supplier nodes
  sorted by `totalTco2e`, the smallest prefix reaching the target cumulative share
  is the hotspot set; each node has `sharePct` / `cumulativeSharePct` / `rank` /
  `isHotspot` / `intensityVsMedian` and explainable `reasons`. `tracePath(graph,
  nodeId)` → `{path, hops}` shortest hop path from the root.
  `CARBON_GRAPH_BUILDER_VERSION = 'carbon-graph@1.0.0'`.
- **`@trace/db/network.ts`**: `listSupplyChainEdges` / `upsertSupplyChainEdge`
  (validates buyer + upstream belong to the org; upserts on `(org,
  from_supplier_id, to_label)`; audit `network.edge_added` / `_updated`) /
  `deleteSupplyChainEdge`. `computeCarbonGraph(db, {organizationId,
  reportingPeriod?, computedByUserId?})` — active suppliers + their period
  emission datapoints (`subject_type = 'supplier'`, `metric_key LIKE 'emission_%'`)
  aggregated per supplier, the backing calculations' methodology → the
  `NodeAttribution` (`supplier_specific` / `spend_based` / `mixed` / `none`), spend
  from `supplier_relationship`, verified `supplier_evidence_ref` fraction as
  `evidenceCoverage`, min current `trust_score`, and the org's own `emission` rows
  for Scope 1 + market-based (else location) Scope 2 as the root's
  `directTco2e`. Builds the node list (org root + suppliers + a stub per declared
  external party) and edge list (org → every active supplier + the declared
  links) → `buildCarbonGraph` + `rankHotspots` → new `carbon_graph_snapshot`
  version; audit `network.graph_computed`. `latestCarbonGraph` /
  `carbonGraphByVersion` / `listCarbonGraphSnapshots` (metadata) /
  `carbonGraphNodeTrace(db, org, nodeId, version?)` → `{path, pathLabels, hops,
  node, calculations[]}` (the node's top emission-backing calculations with
  `methodology` / `factorSource` / `evidenceCount`).
- API: `NetworkController` — `GET /network/graph` (`?version=`), `GET
  /network/graph/history`, `POST /network/graph/compute` (`network.manage`), `GET
  /network/graph/nodes/:nodeId/trace`, `GET` / `POST` / `DELETE /network/edges`.
  Viewing needs `supplier.read`; computing + editing edges needs the new
  `network.manage` permission.
- RLS: `supply_chain_edge` + `carbon_graph_snapshot` are `FORCE` `current_org()`
  (migration `0040_carbon_graph_rls`).

### Product carbon footprints (Phase 14b)

```
product(id, organization_id, name, sku NULL, description, functional_unit,
        reference_amount numeric, reference_unit, boundary default 'cradle_to_gate',
        allocation_method default 'none', allocation_factor numeric(7,6) default 1,
        allocation_note NULL, status default 'active',
        created_by_user_id, created_at, updated_at, deleted_at NULL)

bom_line(id, organization_id, product_id, label, kind (material|energy|transport|
         component|process|packaging), quantity numeric, unit,
         source (factor|supplier|sub_product|manual),
         emission_factor_id NULL, supplier_id NULL, sub_product_id NULL,
         manual_kg_co2e NULL, data_tier (primary|secondary|estimated) default 'secondary',
         note NULL, sort_order, created_at, updated_at)

pcf_record(id, organization_id, product_id, version, method_version, boundary,
           functional_unit, reporting_period NULL, total_kg_co2e numeric(24,6),
           subtotal_kg_co2e numeric(24,6), allocation_method, allocation_factor numeric(7,6),
           primary_data_share_pct, data_quality_rating (A..E), breakdown jsonb,
           inputs_digest, supersedes_id NULL, computed_by_user_id NULL, computed_at,
           UNIQUE(product_id, version))   -- immutable; `breakdown` = the domain ProductFootprint
```

- **`@trace/domain/network/pcf.ts`** (pure): `PCF_METHOD_VERSION = 'pcf@1.0.0'`.
  `PcfLineInput {id, label, kind, source, quantity, unit, kgCo2ePerUnit (number
  |null — already unit-resolved), dataTier, resolvedFrom, note?}`.
  `computeProductFootprint({functionalUnit, boundary, allocation:{method, factor,
  note?}, lines})` → `ProductFootprint` — `factor` outside `[0,1]` throws; per
  line `kgCo2e = quantity × kgCo2ePerUnit` (null → 0 + a warning);
  `subtotalKgCo2e` = Σ; `totalKgCo2e = subtotal × allocation.factor`;
  `breakdown[]` (per-line `{kgCo2e, sharePct, resolvedFrom, warning}`), `byKind[]`
  (non-zero only); `primary/secondary/estimatedDataSharePct` from the
  direct-weighted tier split; `dataQualityRating` A ≥ 80 / B ≥ 60 / C ≥ 40 /
  D ≥ 20 / E; `unresolvedLines`; `warnings`; `inputsDigest` = sha256 of canonical
  `{v, fu, b, a, lines:[[id, kind, source, qty, unit, kgCo2ePerUnit, dataTier]]}`.
  `pcfDataTierForMethodology` maps `supplier_specific` / `fuel_based` /
  `energy_based` → primary, `spend_based` → estimated, else secondary.
- **`@trace/db/pcf.ts`**: `createProduct` / `updateProduct` (validates the
  allocation factor) / `archiveProduct` / `listProducts` (each with its latest
  PCF summary) / `productDetail` (product + BOM lines with resolved factor /
  supplier / sub-product names + latest PCF). `addBomLine` / `updateBomLine` /
  `deleteBomLine` — `validateLineSource` checks the referenced factor
  (`OR organizationId null` for the library), supplier or sub-product exists for
  the org, and rejects a self-referencing sub-product. `computePcf(db,
  {organizationId, productId, reportingPeriod?, computedByUserId?})` — batches one
  `supplierCarbonComparison` for the supplier lines, then per line: `factor` →
  `computeEmission({activityValue:1, activityUnit: line.unit, factorValue,
  factorNumeratorUnit, factorDenominatorUnit, gwpSet, methodology})` →
  `resultValueTco2e × 1000` (a thrown `UnitError` → `kgCo2ePerUnit: null`,
  `dataTier: estimated`); `supplier` → the row's `carbonIntensityPerKEur`
  (tCO2e/€1k == kg/€), `dataTier: estimated`; `sub_product` → the latest
  `pcf_record.totalKgCo2e`, `dataTier` primary if the sub-PCF is A/B else
  secondary; `manual` → the declared value. Runs `computeProductFootprint`,
  persists `pcf_record` version `(max)+1` with `supersedesId = prev`, `breakdown =
  footprint` JSON, `inputsDigest`; audit `pcf.computed`. `latestPcf` /
  `pcfByVersion` / `listPcfRecords`.
- `@trace/shared`: `product.read` (in `READ_ONLY_SUSTAINABILITY`) and
  `product.manage` — both added next to `calculation.*` for the sustainability
  roles; `organization_admin` holds all.
- API: `ProductsController` — `GET` / `POST /products`, `GET` / `PATCH` /
  `DELETE /products/:id`, `POST` / `PATCH` / `DELETE /products/:id/bom[/:lineId]`,
  `POST /products/:id/pcf/compute`, `GET /products/:id/pcf` (`?version=`) +
  `/pcf/history`. `product.read` for reads, `product.manage` for writes.
- RLS: `product` + `bom_line` + `pcf_record` are `FORCE` `current_org()`
  (migration `0042_pcf_rls`).

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
