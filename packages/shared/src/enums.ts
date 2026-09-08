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
