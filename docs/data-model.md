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
