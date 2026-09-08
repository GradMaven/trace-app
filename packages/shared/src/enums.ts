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

export const JOB_STATE = [
  'queued',
  'processing',
  'completed',
  'failed',
  'retrying',
] as const;
export type JobState = (typeof JOB_STATE)[number];

export const DISCLOSURE_STATUS = [
  'not_started',
  'data_available',
  'evidence_available',
  'mapping_complete',
  'review_required',
] as const;
export type DisclosureStatus = (typeof DISCLOSURE_STATUS)[number];

export const MEMBERSHIP_STATUS = ['invited', 'active', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number];
