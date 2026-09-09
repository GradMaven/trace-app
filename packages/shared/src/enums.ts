/**
 * Load-bearing shared vocabularies. These mirror Postgres enums defined in
 * @trace/db and are referenced across domain, API, and UI.
 */

/** How a datapoint came to exist. Never downgraded silently (brief Principle 3). */
export const PROVENANCE = [
  'measured',
  'supplier_reported',
  'calculated',
  'estimated',
  'modeled',
  'inferred',
] as const;
export type Provenance = (typeof PROVENANCE)[number];

/** Trust label lifecycle. `ai_extracted -> verified` automatically is disallowed. */
export const DATA_LABEL = ['ai_extracted', 'human_reviewed', 'verified'] as const;
export type DataLabel = (typeof DATA_LABEL)[number];

export const EVIDENCE_TYPE = [
  'supplier_report',
  'invoice',
  'utility_bill',
  'certificate',
  'epd',
  'lca',
  'audit_report',
  'questionnaire',
  'erp_record',
  'logistics_record',
  'contract',
  'external_dataset',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPE)[number];

export const EVIDENCE_STATUS = [
  'uploaded',
  'processing',
  'extracted',
  'reviewed',
  'verified',
  'rejected',
  'expired',
  'superseded',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUS)[number];

export const GHG_SCOPE = ['scope_1', 'scope_2_location', 'scope_2_market', 'scope_3'] as const;
export type GhgScope = (typeof GHG_SCOPE)[number];

/** GHG Protocol Scope 3 categories. Null on Scope 1/2 calculations. */
export const GHG_CATEGORY = [
  'cat_1_purchased_goods_services',
  'cat_2_capital_goods',
  'cat_3_fuel_energy_activities',
  'cat_4_upstream_transportation',
  'cat_5_waste_generated',
  'cat_6_business_travel',
  'cat_7_employee_commuting',
  'cat_8_upstream_leased_assets',
  'cat_9_downstream_transportation',
  'cat_10_processing_sold_products',
  'cat_11_use_sold_products',
  'cat_12_end_of_life_sold_products',
  'cat_13_downstream_leased_assets',
  'cat_14_franchises',
  'cat_15_investments',
] as const;
export type GhgCategory = (typeof GHG_CATEGORY)[number];

/** Calculation methodology (drives factor selection and quality tiering). */
export const METHODOLOGY = [
  'supplier_specific',
  'average_data',
  'spend_based',
  'distance_based',
  'fuel_based',
  'energy_based',
  'hybrid',
] as const;
export type Methodology = (typeof METHODOLOGY)[number];

/** Higher = better primary-data quality. Used by the Trust engine (Phase 6). */
export const METHODOLOGY_QUALITY_TIER: Record<Methodology, number> = {
  supplier_specific: 5,
  fuel_based: 4,
  energy_based: 4,
  distance_based: 3,
  hybrid: 3,
  average_data: 2,
  spend_based: 1,
};

// ---------------------------------------------------------------------------
// Phase 6 — Trust Engine
// ---------------------------------------------------------------------------

/**
 * TRACE Trust Score band. Derived from the 0–100 score by fixed thresholds so
 * the qualitative label is itself documented, not a moving average.
 * high ≥ 75, medium 50–74, low < 50.
 */
export const TRUST_BAND = ['high', 'medium', 'low'] as const;
export type TrustBand = (typeof TRUST_BAND)[number];

export function trustBand(value: number): TrustBand {
  if (value >= 75) return 'high';
  if (value >= 50) return 'medium';
  return 'low';
}

/**
 * Trust Score dimensions and their maximum contributions
 * (docs/domain-model.md#trace-trust-score-model). The weight table is
 * configuration, versioned with the model; historical scores keep their version.
 */
export const TRUST_DIMENSION = [
  'primary_data',
  'evidence_attached',
  'verified',
  'factor_quality',
  'unit_methodology',
  'period_freshness',
  'completeness',
] as const;
export type TrustDimension = (typeof TRUST_DIMENSION)[number];

export const DATA_QUALITY_ISSUE_KIND = [
  'missing_value',
  'missing_unit',
  'missing_evidence',
  'unverified_evidence',
  'expired_evidence',
  'stale_data',
  'unit_inconsistency',
  'impossible_value',
  'duplicate',
  'conflicting_supplier_report',
  'outdated_factor',
  'low_methodology_tier',
] as const;
export type DataQualityIssueKind = (typeof DATA_QUALITY_ISSUE_KIND)[number];

/** Issue severity. `critical` blocks trustworthy reporting; `warning` needs a look; `info` is advisory. */
export const ISSUE_SEVERITY = ['critical', 'warning', 'info'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITY)[number];

/**
 * Data-quality issue lifecycle. `open` → `acknowledged` (seen, not yet fixed) →
 * `resolved` (fixed; a re-scan that no longer detects it also resolves it) or
 * `dismissed` (a human judged it not a real problem — recorded, not deleted).
 */
export const ISSUE_STATUS = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
export type IssueStatus = (typeof ISSUE_STATUS)[number];

export const ANOMALY_METHOD = ['mad_outlier', 'relative_change'] as const;
export type AnomalyMethod = (typeof ANOMALY_METHOD)[number];

export const ANOMALY_STATUS = ['open', 'explained', 'dismissed'] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUS)[number];

export const JOB_STATE = ['queued', 'processing', 'completed', 'failed', 'retrying'] as const;
export type JobState = (typeof JOB_STATE)[number];

export const DISCLOSURE_STATUS = [
  'not_started',
  'data_available',
  'evidence_available',
  'mapping_complete',
  'review_required',
] as const;
export type DisclosureStatus = (typeof DISCLOSURE_STATUS)[number];

// ---------------------------------------------------------------------------
// Phase 7 — Compliance
// ---------------------------------------------------------------------------

/**
 * Objective status of a required disclosure / datapoint mapping. TRACE never
 * says "compliant" (brief §44, compliance-architecture.md). `review_required` is
 * an override state — data exists but has a problem a human must judge.
 */
export const COMPLIANCE_STATUS = [
  'not_started',
  'data_available',
  'evidence_available',
  'mapping_complete',
  'review_required',
] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUS)[number];

/** Ladder rank for the non-override states; `review_required` is handled separately. */
export const COMPLIANCE_STATUS_RANK: Record<ComplianceStatus, number> = {
  not_started: 0,
  data_available: 1,
  evidence_available: 2,
  mapping_complete: 3,
  review_required: 1,
};

/** Why a required datapoint is not yet `mapping_complete`. */
export const GAP_REASON = [
  'missing_data',
  'no_evidence',
  'expired_evidence',
  'conflicting_data',
  'outdated_factor',
  'unit_mismatch',
  'low_trust_score',
  'reporting_period_mismatch',
  'unconfirmed_mapping',
] as const;
export type GapReason = (typeof GAP_REASON)[number];

/** Lifecycle of an organization-level control expected for a requirement. */
export const CONTROL_STATUS = [
  'not_implemented',
  'implemented',
  'needs_testing',
  'passed',
  'failed',
] as const;
export type ControlStatus = (typeof CONTROL_STATUS)[number];

export const REQUIRED_DATAPOINT_CARDINALITY = ['single', 'multiple'] as const;
export type RequiredDatapointCardinality = (typeof REQUIRED_DATAPOINT_CARDINALITY)[number];

export const MEMBERSHIP_STATUS = ['invited', 'active', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number];
