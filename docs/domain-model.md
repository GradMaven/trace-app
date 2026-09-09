# Domain Model

Conceptual model. Physical tables, keys and indexes are in
[data-model.md](data-model.md). Language and naming follow the brief's product vocabulary
(Principle 48): *evidence*, *datapoint*, *calculation lineage*, *estimated*, *verification
status*.

## The lineage spine

The chain any material number can be walked along, in both directions:

```
        supports                input to               produces
Evidence ────────► Datapoint ────────────► Calculation ────────► Emission
   ▲                   ▲                        │                    │
   │                   │                        │ uses               │ rolls up to
Document           ActivityData                 ▼                    ▼
   ▲                   ▲                  EmissionFactor        Scope 1/2/3 total
 upload                │                  (version pinned)           │
                Supplier / Facility /                                ▼
                Product / Material /                          ESRS Disclosure
                Transaction
```

Downward navigation (Evidence DNA):

```
Emission → Calculation → ActivityData → Supplier → Document
```

Upward navigation (impact of a document):

```
Document → extracted Datapoint → Calculation → Emission → ESRS Disclosure
```

## Aggregates & entities

### Identity & Tenancy

| Entity | Notes |
| --- | --- |
| `Organization` | The tenant. Legal entity attributes, country, base currency (EUR default), reporting-period configuration. |
| `BusinessUnit` | Optional hierarchy under an organization. |
| `User` | A person. Global identity; may hold memberships in several organizations. |
| `Membership` | `User` ↔ `Organization` with a set of `Role`s. Carries the tenant-scoped identity. |
| `Role` | Named bundle of permissions, per organization (plus platform roles). |
| `Permission` | Fine-grained verb on a resource: `evidence.verify`, `supplier.invite`, `calculation.approve`, `report.generate`, `audit.read`, … |
| `Session` | Server session for cookie auth; supports MFA state. |
| `ApiKey` | Scoped programmatic access (Phase 13), permission-limited. |

Roles (seed): Platform Admin, Organization Admin, Sustainability Manager, ESG Analyst,
Procurement Manager, Finance, Auditor, Supplier User.

### Supply Chain

| Entity | Notes |
| --- | --- |
| `Supplier` | Company record within an organization's supply chain. Identity: name, country, locations, industry (NACE), registration IDs. |
| `SupplierRelationship` | The business relationship: category, spend, tier, since. |
| `SupplierPassport` | Aggregated, versioned view: identity, carbon (Scope 1/2/relevant 3, PCF, intensity, methodology), environmental (energy, water, waste, materials, biodiversity where applicable), social (workforce, H&S, human rights, certifications), governance (policies, certifications, compliance indicators), and the evidence backing each. |
| `Facility` | Physical site of the organization or a supplier. Gelocation, type, operational control flag. |
| `Product` | A finished/intermediate product; may have a product carbon footprint. |
| `Material` | Input material; links to emission factors and EPD/LCA evidence. |
| `Transaction` | Procurement or logistics line item: supplier, material/product, quantity, unit, spend, date, origin/destination. Source of activity data. |

### Carbon

| Entity | Notes |
| --- | --- |
| `ActivityData` | A quantity of an activity in a reporting period: value, unit, category, source reference, `provenance`. |
| `Unit` / `UnitConversion` | Units registry (metric-first) and conversion factors; conversions are explicit and stored on the calculation. |
| `EmissionFactor` | **Versioned.** `value`, `unit` (e.g. `tCO2e/tonne`), `source` (DEFRA, EXIOBASE, ecoinvent, ADEME, supplier-specific…), `version`, `valid_from`, `valid_to`, `gwp_set` (e.g. AR6), scope/category applicability, geography. |
| `Methodology` | Named method: supplier-specific, average-data, spend-based, distance-based, fuel-based, hybrid. Carries a quality tier. |
| `Calculation` | **Immutable.** Stores inputs by value and by reference; see the object below. Recalculation creates a new row with `supersedes_id`. |
| `Emission` | Rolled-up result: scope (1 / 2 location / 2 market / 3), GHG Protocol category, reporting period, value in tCO2e, links to contributing calculations. |

`Calculation` object:

```ts
Calculation {
  id
  organizationId
  activityId
  emissionFactorId          // a specific version row
  methodology
  inputValue
  inputUnit
  normalizedValue
  normalizedUnit
  factorValue
  factorUnit
  factorSource
  factorVersion
  resultValue
  resultUnit
  assumptions               // JSONB: documented assumptions + parameters
  calculatedAt
  calculationVersion        // engine version, e.g. "calc-engine@1.3.0"
  supersedesId?             // previous calculation this one replaces
}
```

Invariant: `@trace/domain.recompute(calculation.inputs)` reproduces `resultValue` exactly.

### Evidence

| Entity | Notes |
| --- | --- |
| `Document` | The stored file. `id`, tenant ownership, MIME, size, `checksum` (sha256), storage location (opaque), `version`, processing status, retention info, access control. Raw paths never exposed; access via signed URLs. |
| `Evidence` | Proof supporting one or more datapoints. Fields below. Lifecycle state machine. |
| `Datapoint` | A material value: `value`, `unit`, `provenance`, reporting period, subject reference (supplier/facility/product/activity), `trustScoreId`, links to supporting `Evidence`. |
| `CandidateDatapoint` | AI-proposed datapoint awaiting human review: same shape + `sourceSpans`, `confidence`, `aiJobId`, `status` (`pending | promoted | rejected`). Never used in trusted reporting. |
| `Verification` | Who/what verified an evidence or datapoint, method, date, outcome. |

`Evidence` object:

```ts
Evidence {
  id
  organizationId
  type            // supplier_report | invoice | utility_bill | certificate | epd | lca |
                  // audit_report | questionnaire | erp_record | logistics_record |
                  // contract | external_dataset
  title
  documentId
  source
  sourceUrl
  reportingPeriod
  issuer
  uploadedBy
  uploadedAt
  verificationStatus     // unverified | in_review | verified | rejected | expired | superseded
  verificationMethod
  confidenceScore
  hash
  metadata               // JSONB
  version
  supersedesId?
}
```

Evidence lifecycle:

```
Uploaded → Processing → Extracted → Reviewed → Verified → (Expired | Superseded)
                              │
                              └────────────► Rejected
```

Provenance enum (shared, on every `Datapoint` and `ActivityData`):

```
measured | supplier_reported | calculated | estimated | modeled | inferred
```

### Trust & Quality

| Entity | Notes |
| --- | --- |
| `TrustScore` | `value` (0–100), `breakdown` (itemised contributions), `modelVersion`, `subjectType`, `subjectId`, `computedAt`. Model is documented and configurable; see [trust model](#trace-trust-score-model). |
| `DataQualityIssue` | Detected problem: missing value, duplicate, unit inconsistency, impossible value, stale data, conflicting supplier reports, missing evidence, suspicious change, outdated factor. Links to the object; has a status. |
| `Anomaly` | A flagged statistical deviation with candidate explanations. |

#### TRACE Trust Score model

Documented, additive, replaceable. Default dimensions and weights (v1):

| Dimension | Max | Basis |
| --- | --- | --- |
| Primary vs secondary data | 25 | `provenance` = measured / supplier_reported scores highest. |
| Evidence attached | 20 | At least one linked, non-expired `Evidence`. |
| Verified supplier / evidence | 15 | `verificationStatus = verified`. |
| Emission-factor quality & currency | 15 | Recognised source + within `valid_from/to` + matching GWP set. |
| Unit / methodology consistency | 10 | Units resolve cleanly; methodology tier appropriate. |
| Reporting-period freshness | 9 | Data within the active reporting period. |
| Completeness | 6 | Required companion fields present. |
| **Total** | **100** | |

Every score renders its breakdown (Principle 9 of the brief). The weight table is
configuration, versioned as `trust-model@x.y.z`, and historical scores keep their model
version.

**Implementation status (Phase 6).** `@trace/domain/trust.scoreDatapoint` implements this
table as `trust-model@1.0.0` — pure, additive, each dimension awarding an integer 0..max,
returning `{ value, band, breakdown[] }` where each `breakdown` entry is
`{ dimension, max, awarded, rationale }`. Band thresholds are fixed and documented
(`high ≥ 75`, `medium 50–74`, `low < 50`). Scores are stored immutably and version-chained
in `trust_score` (`supersedesId`); a recompute with an unchanged input digest is a no-op.
The companion data-quality engine `evaluateDatapointQuality` (`quality-rules@1.0.0`, 12
`DataQualityIssueKind`s) and `detectAnomalies` (`anomaly-detector@1.0.0`: modified z-score
over history + peers, period-over-period step) are likewise pure and versioned. See
[data-model.md](data-model.md#trust-engine-phase-6) and
[ADR-006](decisions/ADR-006-trust-score-model.md).

### Compliance

See [compliance-architecture.md](compliance-architecture.md). Entities: `Regulation`,
`Requirement`, `Disclosure`, `RequiredDatapoint`, `EvidenceRequirement`, `Control`,
`ComplianceMapping`, `DisclosureStatus`. All carry the `ruleStoreVersion` they were
evaluated against.

Disclosure status vocabulary (objective, never "compliant"):

```
data_available | evidence_available | mapping_complete | review_required | not_started
```

**Implementation status (Phase 7).** The rule store lives as frozen, versioned typed data
in **`@trace/compliance`** (`esrs@2026.1` — ESRS E1 climate) and the generic engine
`evaluateRuleStore` (pure) turns the tenant's datapoints + evidence + Trust Scores +
factor validity into a status per required datapoint, rolled up to disclosures by
`rollUpDisclosureStatus`. `not_started → data_available → evidence_available →
mapping_complete`; `review_required` overrides when data exists but has a problem;
`mapping_complete` needs a human-confirmed mapping and a Trust Score at/above threshold.
`@trace/db` loads a version into the global rule tables and persists
`compliance_mapping` / `disclosure_status` / `compliance_run` (tenant, RLS). See
[data-model.md](data-model.md#compliance-phase-7) and
[ADR-007](decisions/ADR-007-compliance-rule-store.md).

### Audit

| Entity | Notes |
| --- | --- |
| `Audit` | An audit engagement / scope + period. |
| `AuditFinding` | Issue with severity (`critical | warning | info`), linked object, status, resolution. |
| `AuditPackage` | Exportable bundle: evidence, calculations, assumptions, approvals, changes, verification status. |
| `AuditSimulationRun` | Result of scanning the org: readiness %, counts, itemised issues, each linking to its object. |

**Implementation status (Phase 8).** `@trace/domain/audit.assessReadiness`
(`audit-readiness@1.0.0`) is a pure additive 0–100 score over evidence verification,
calculation reproducibility and approval, data quality, Trust level, compliance mapping and
audit-trail integrity, returning a per-dimension breakdown and itemised issues. `@trace/db`
`runAuditSimulation` composes `reproduceCalculation`, `verifyAuditChain`, the data-quality
issues, Trust Scores and the compliance mappings, and persists `audit_simulation_run` +
idempotent `audit_finding` rows; `generateAuditPackage` writes a content-addressed
canonical-JSON bundle to object storage. See
[data-model.md](data-model.md#audit-workspace-phase-8) and
[ADR-008](decisions/ADR-008-audit-workspace.md).

### Process & Ops

| Entity | Notes |
| --- | --- |
| `Workflow` / `WorkflowInstance` | Generic, reusable process engine. Example instance: supplier data request → upload → AI extract → analyst review → approve → recalculation → audit trail. |
| `Task` | Assigned unit of work with due date, linked object, state. |
| `Notification` | User-facing event. |
| `Integration` / `IntegrationRun` | Connector config + execution record; all connectors implement `IntegrationAdapter`. |
| `AIJob` | One model call: `model`, `promptVersion`, `inputType`, `inputRef`, `output`, `confidence`, `tokensIn/Out`, `cost`, `latencyMs`, `reviewerId`, `status`, `createdAt`. |
| `AuditLog` | Append-only, hash-chained. |
| `Job` | UI-visible mirror of a queue job's state. |

## State machines (summary)

| Object | States |
| --- | --- |
| Evidence | `uploaded → processing → extracted → reviewed → verified → expired\|superseded`; `→ rejected` from `reviewed`. |
| CandidateDatapoint | `pending → promoted \| rejected`. |
| Data label | `ai_extracted → human_reviewed → verified` (auto `ai_extracted → verified` disallowed). |
| Job / AIJob / IntegrationRun | `queued → processing → completed \| failed \| retrying`. |
| DisclosureStatus | `not_started → data_available → evidence_available → mapping_complete → review_required`. |
| Task | `open → in_progress → blocked → done \| cancelled`. |

## Seed / demo domain

**NordWerk Manufacturing AG** — Germany, industrial manufacturing. Seed includes 20
suppliers, 5 facilities, 15 materials, 10 products, activity records, calculations,
emissions, evidence documents, compliance gaps and audit findings, all explicitly flagged
as demo/seed data (Principle 43). The demo scenario (1,240 suppliers, €420M procurement,
Scope 3 discovery, top-10 suppliers = 41% of Scope 3, one supplier PDF processed end to
end) is the target of the vertical slice.
