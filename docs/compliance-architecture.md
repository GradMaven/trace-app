# Compliance Architecture

## Principle

Regulatory logic is **versioned data**, not code (Principle 7). CSRD/ESRS rules, and later
EU Taxonomy, CSDDD, CBAM, EUDR, ESPR / Digital Product Passport, GHG Protocol and ISSB, are
**not** hard-coded into React components or scattered `if` branches. They live in a
versioned rule store evaluated by a generic engine.

TRACE distinguishes, and never conflates:

- **software calculation** — deterministic arithmetic on activity data and factors;
- **regulatory mapping** — "this datapoint appears to satisfy this required disclosure";
- **user interpretation** — the sustainability/compliance professional's judgement;
- **legal advice** — not provided.

No screen ever says "CSRD compliant". Status is objective:
`not_started | data_available | evidence_available | mapping_complete | review_required`.

## Rule store model

```
Regulation
   └── Requirement
         └── Disclosure
               ├── RequiredDatapoint      (metric_key, unit, cardinality, conditions)
               ├── EvidenceRequirement    (description, acceptable evidence types)
               └── Control                (org-level control expected for this requirement)
```

Every node carries `rule_store_version` (e.g. `esrs@2026.1`). The store is a versioned,
reviewable dataset in `packages/compliance/rules/<regulation>/<version>/…` (structured
files), loaded into the `regulation` / `requirement` / `disclosure` / `required_datapoint` /
`evidence_requirement` tables by a migration-like loader. Superseding a version does not
mutate prior rows.

## Evaluation flow

```
Regulation
   ↓ (rule store)
Requirement
   ↓
Required datapoint  ──────────────┐
   ↓                              │
Evidence requirement              │  generic mapping engine
   ↓                              │
Company data (datapoint / calc)  ◄┘
   ↓
Evidence
   ↓
Status  →  compliance_mapping row  { required_datapoint_id, datapoint_id?, calculation_id?,
                                     status, gap_reason, rule_store_version, computed_at }
```

The mapping engine (`packages/compliance`) is pure: given the tenant's datapoints,
calculations and evidence plus a rule-store version, it produces `compliance_mapping` and
`disclosure_status` rows. It **suggests**; a permissioned human confirms mappings that are
not deterministic. AI (compliance-mapping capability) may propose candidate links but never
sets a final status.

## Gap analysis

For each `RequiredDatapoint` the engine yields one of:

| Status | Meaning |
| --- | --- |
| `not_started` | No candidate company data. |
| `data_available` | A datapoint/calculation exists but lacks linked evidence. |
| `evidence_available` | Data + at least one non-expired linked evidence. |
| `mapping_complete` | Data + evidence + confirmed mapping + Trust Score above threshold. |
| `review_required` | Any of: conflicting data, expired evidence, outdated factor, unit mismatch, low Trust Score, reporting-period conflict. |

Gaps link directly to the underlying object (Principle 10 of the brief — every issue is
navigable).

## ESRS-first scope

Phase 7 implements ESRS **climate and value-chain** concepts first (ESRS E1 datapoints
relevant to Scope 1/2/3, energy, targets; value-chain coverage). The schema and engine are
regulation-agnostic, so adding EU Taxonomy or CBAM later is a new rule-store dataset plus
any new metric keys — not an engine rewrite.

## Versioning & reproducibility

- A disclosure evaluated under `esrs@2026.1` keeps that stamp. Upgrading to `esrs@2027.1`
  produces new `compliance_mapping` rows; the old ones remain for audit.
- Report packages record which rule-store version they were built against.

## Boundaries in the UI

- Compliance screens show **status + evidence + mapping completeness + "review required"**,
  with a persistent disclaimer that TRACE supports professional judgement and does not
  provide legal advice or guarantee compliance (Principle 44).
- The "why" behind every status is expandable to the contributing datapoints, evidence and
  Trust Score.
