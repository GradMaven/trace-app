import {
  METHODOLOGY_QUALITY_TIER,
  TRUST_DIMENSION,
  trustBand,
  type DataLabel,
  type Methodology,
  type Provenance,
  type TrustBand,
  type TrustDimension,
} from '@trace/shared';

/**
 * TRACE Trust Score model (docs/domain-model.md#trace-trust-score-model).
 *
 * Documented, additive, replaceable. Each dimension contributes an integer
 * between 0 and its configured maximum; the score is the sum (0–100). Every
 * score renders its breakdown (brief Principle 9). The weight table below is
 * configuration, versioned with `TRUST_MODEL_VERSION`; historical scores keep
 * the version they were computed with.
 *
 * Pure — no I/O. The caller (packages/db) gathers the datapoint, its evidence,
 * its calculation/factor and the active reporting period into a `TrustInput`.
 */

export const TRUST_MODEL_VERSION = 'trust-model@1.0.0';

export const TRUST_WEIGHTS: Record<TrustDimension, number> = {
  primary_data: 25,
  evidence_attached: 20,
  verified: 15,
  factor_quality: 15,
  unit_methodology: 10,
  period_freshness: 9,
  completeness: 6,
};

export const TRUST_MAX = Object.values(TRUST_WEIGHTS).reduce((a, b) => a + b, 0); // 100

export interface TrustEvidenceRef {
  /** Linked-evidence lifecycle state. */
  status: string;
  /** ISO date the evidence expires, or null. */
  expiresAt: string | null;
  /** A verification with a passing outcome exists, or the evidence itself is `verified`. */
  verified: boolean;
}

export interface TrustFactorRef {
  /** True when `source` is on the recognised emission-factor source list (caller resolves). */
  recognisedSource: boolean;
  /** ISO date the factor is valid from. */
  validFrom: string;
  /** ISO date the factor is valid to, or null for open-ended. */
  validTo: string | null;
  /** GWP characterisation set the factor uses, e.g. "AR6". */
  gwpSet: string;
  /** GWP set the organization reports on. */
  expectedGwpSet: string;
  /** ISO date the factor validity is tested against (the activity/calculation date). */
  asOf: string;
}

export interface TrustCompanionField {
  key: string;
  present: boolean;
}

export interface TrustInput {
  provenance: Provenance;
  label: DataLabel;
  /** The datapoint's unit; null for a text-valued datapoint. */
  unit: string | null;
  /** The unit string resolves in the @trace/domain unit registry (caller resolves). */
  unitResolves: boolean;
  /** The datapoint carries a value (numeric or text). */
  valuePresent: boolean;
  /** Methodology of the backing calculation, or null for a direct datapoint. */
  methodology: Methodology | null;
  /** The datapoint's reporting period label, e.g. "FY2025". */
  reportingPeriod: string | null;
  /** The organization's active reporting period label. */
  activeReportingPeriod: string | null;
  /** Linked evidence (any status). */
  evidence: TrustEvidenceRef[];
  /** The emission factor behind the datapoint's calculation, or null. */
  factor: TrustFactorRef | null;
  /** Companion fields that ought to be present for this metric. Empty = nothing required. */
  companionFields: TrustCompanionField[];
}

export interface TrustContribution {
  dimension: TrustDimension;
  max: number;
  awarded: number;
  rationale: string;
}

export interface TrustScoreResult {
  value: number;
  band: TrustBand;
  modelVersion: string;
  breakdown: TrustContribution[];
}

const PROVENANCE_POINTS: Record<Provenance, number> = {
  measured: 25,
  supplier_reported: 21,
  calculated: 15,
  estimated: 9,
  modeled: 7,
  inferred: 4,
};

const LIVE_EVIDENCE = new Set(['uploaded', 'processing', 'extracted', 'reviewed', 'verified']);

/** Trailing calendar year in a period label ("FY2025" | "2025" | "2025-Q3" → 2025). */
export function periodYear(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

function primaryData(input: TrustInput): TrustContribution {
  const awarded = PROVENANCE_POINTS[input.provenance];
  return {
    dimension: 'primary_data',
    max: TRUST_WEIGHTS.primary_data,
    awarded,
    rationale: `provenance "${input.provenance}"`,
  };
}

function evidenceAttached(input: TrustInput): TrustContribution {
  const max = TRUST_WEIGHTS.evidence_attached;
  const live = input.evidence.filter(
    (e) => LIVE_EVIDENCE.has(e.status) && (!e.expiresAt || e.expiresAt >= todayOf(input)),
  );
  if (live.length > 0) {
    return {
      dimension: 'evidence_attached',
      max,
      awarded: max,
      rationale: `${live.length} live evidence record(s) linked`,
    };
  }
  if (input.evidence.length > 0) {
    return {
      dimension: 'evidence_attached',
      max,
      awarded: 6,
      rationale: 'evidence linked but all expired, rejected or superseded',
    };
  }
  return { dimension: 'evidence_attached', max, awarded: 0, rationale: 'no evidence linked' };
}

function verified(input: TrustInput): TrustContribution {
  const max = TRUST_WEIGHTS.verified;
  const hasVerifiedEvidence = input.evidence.some((e) => e.verified && e.status === 'verified');
  if (input.label === 'verified' || hasVerifiedEvidence) {
    return {
      dimension: 'verified',
      max,
      awarded: max,
      rationale: 'datapoint or its evidence is verified',
    };
  }
  if (input.label === 'human_reviewed') {
    return {
      dimension: 'verified',
      max,
      awarded: 7,
      rationale: 'human-reviewed but not independently verified',
    };
  }
  return { dimension: 'verified', max, awarded: 0, rationale: `label "${input.label}"` };
}

function factorQuality(input: TrustInput): TrustContribution {
  const max = TRUST_WEIGHTS.factor_quality;
  if (!input.factor) {
    return {
      dimension: 'factor_quality',
      max,
      awarded: max,
      rationale: 'no emission factor involved (direct datapoint)',
    };
  }
  const f = input.factor;
  let awarded = 0;
  const parts: string[] = [];
  if (f.recognisedSource) {
    awarded += 6;
    parts.push('recognised source');
  } else {
    parts.push('unrecognised source');
  }
  const withinValidity = f.validFrom <= f.asOf && (!f.validTo || f.validTo >= f.asOf);
  if (withinValidity) {
    awarded += 5;
    parts.push('within validity window');
  } else {
    parts.push('outside validity window');
  }
  if (f.gwpSet === f.expectedGwpSet) {
    awarded += 4;
    parts.push(`GWP set ${f.gwpSet} matches`);
  } else {
    parts.push(`GWP set ${f.gwpSet} ≠ reported ${f.expectedGwpSet}`);
  }
  return { dimension: 'factor_quality', max, awarded, rationale: parts.join('; ') };
}

function unitMethodology(input: TrustInput): TrustContribution {
  const max = TRUST_WEIGHTS.unit_methodology;
  let awarded = 0;
  const parts: string[] = [];
  if (input.unit === null || input.unitResolves) {
    awarded += 6;
    parts.push(input.unit === null ? 'no unit required' : 'unit resolves cleanly');
  } else {
    parts.push(`unit "${input.unit}" does not resolve`);
  }
  if (input.methodology === null) {
    awarded += 4;
    parts.push('no methodology (direct)');
  } else {
    const tier = METHODOLOGY_QUALITY_TIER[input.methodology];
    const pts = tier >= 4 ? 4 : tier >= 3 ? 3 : tier >= 2 ? 2 : 0;
    awarded += pts;
    parts.push(`methodology "${input.methodology}" tier ${tier}`);
  }
  return { dimension: 'unit_methodology', max, awarded, rationale: parts.join('; ') };
}

function periodFreshness(input: TrustInput): TrustContribution {
  const max = TRUST_WEIGHTS.period_freshness;
  const dpYear = periodYear(input.reportingPeriod);
  const activeYear = periodYear(input.activeReportingPeriod);
  if (dpYear === null || activeYear === null) {
    return {
      dimension: 'period_freshness',
      max,
      awarded: 0,
      rationale: 'reporting period unknown',
    };
  }
  const gap = activeYear - dpYear;
  const awarded = gap <= 0 ? max : gap === 1 ? 5 : gap === 2 ? 2 : 0;
  return {
    dimension: 'period_freshness',
    max,
    awarded,
    rationale:
      gap <= 0 ? 'within the active reporting period' : `${gap} reporting period(s) behind`,
  };
}

function completeness(input: TrustInput): TrustContribution {
  const max = TRUST_WEIGHTS.completeness;
  if (input.companionFields.length === 0) {
    return {
      dimension: 'completeness',
      max,
      awarded: max,
      rationale: 'no companion fields required',
    };
  }
  const present = input.companionFields.filter((f) => f.present);
  const awarded = Math.round((present.length / input.companionFields.length) * max);
  const missing = input.companionFields.filter((f) => !f.present).map((f) => f.key);
  return {
    dimension: 'completeness',
    max,
    awarded,
    rationale:
      missing.length === 0 ? 'all companion fields present' : `missing: ${missing.join(', ')}`,
  };
}

/** `activeReportingPeriod` year is the anchor "today" for evidence-expiry checks; fall back to real now. */
function todayOf(input: TrustInput): string {
  const y = periodYear(input.activeReportingPeriod);
  return y ? `${y}-12-31` : new Date().toISOString().slice(0, 10);
}

const DIMENSION_FNS: Record<TrustDimension, (input: TrustInput) => TrustContribution> = {
  primary_data: primaryData,
  evidence_attached: evidenceAttached,
  verified,
  factor_quality: factorQuality,
  unit_methodology: unitMethodology,
  period_freshness: periodFreshness,
  completeness,
};

export function scoreDatapoint(input: TrustInput): TrustScoreResult {
  const breakdown = TRUST_DIMENSION.map((d) => {
    const c = DIMENSION_FNS[d](input);
    // Clamp defensively so a model bug can never exceed the published maximum.
    return { ...c, awarded: Math.max(0, Math.min(c.max, Math.round(c.awarded))) };
  });
  const value = breakdown.reduce((a, c) => a + c.awarded, 0);
  return { value, band: trustBand(value), modelVersion: TRUST_MODEL_VERSION, breakdown };
}
