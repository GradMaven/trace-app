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
trust_score(id, organization_id, subject_type, subject_id, value numeric(5,2),
            breakdown jsonb, model_version, computed_at)
data_quality_issue(id, organization_id, kind, severity, subject_type, subject_id,
                   details jsonb, status, created_at, resolved_at NULL)
anomaly(id, organization_id, subject_type, subject_id, metric_key, observed, expected,
        deviation_pct numeric, explanations jsonb, status, created_at)

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
