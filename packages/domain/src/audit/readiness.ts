import {
  AUDIT_READINESS_DIMENSION,
  trustBand,
  type AuditIssueKind,
  type AuditReadinessDimension,
  type FindingSeverity,
  type TrustBand,
} from '@trace/shared';

/**
 * Audit-readiness model (docs/domain-model.md "Audit", ADR-008).
 *
 * Documented, additive, replaceable. Each dimension contributes an integer
 * 0..max; the score is the sum (0–100). The assessment also emits itemised
 * issues, each pointing at the object to fix (Principle 10) — the caller
 * (`@trace/db`) persists these as `audit_finding` rows (source `simulation`).
 *
 * Pure — no I/O. The caller gathers the tenant's evidence, calculations, trust
 * scores, data-quality issues, compliance mappings and audit-chain status into a
 * `ReadinessInput`.
 */

export const AUDIT_READINESS_MODEL_VERSION = 'audit-readiness@1.0.0';

export const READINESS_WEIGHTS: Record<AuditReadinessDimension, number> = {
  evidence_verified: 25,
  calculations_reproducible: 20,
  calculations_approved: 15,
  data_quality: 15,
  trust_level: 10,
  compliance_mapping: 10,
  audit_trail_integrity: 5,
};

export const READINESS_MAX = Object.values(READINESS_WEIGHTS).reduce((a, b) => a + b, 0); // 100

const LOW_TRUST_THRESHOLD = 50;

export interface ReadinessDatapoint {
  id: string;
  metricKey: string;
  subjectType: string;
  subjectId: string;
  hasCalculation: boolean;
  /** Linked evidence that is verified and not expired. */
  liveVerifiedEvidence: number;
  /** Linked evidence not expired / rejected / superseded (verified or not). */
  liveEvidence: number;
  expiredEvidence: number;
  trustScore: number | null;
}

export interface ReadinessCalculation {
  id: string;
  scope: string;
  reportingPeriod: string;
  reproduced: boolean;
  approved: boolean;
}

export interface ReadinessQualityIssue {
  id: string;
  subjectType: string;
  subjectId: string;
  metricKey: string | null;
  title: string;
}

export interface ReadinessComplianceGap {
  requiredDatapointKey: string;
  disclosureCode: string;
  status: string; // not_started | data_available | review_required
  title: string;
}

export interface ReadinessInput {
  reportingPeriod: string | null;
  datapoints: ReadinessDatapoint[];
  calculations: ReadinessCalculation[];
  openCriticalQualityIssues: ReadinessQualityIssue[];
  openWarningQualityIssueCount: number;
  complianceRequiredTotal: number;
  complianceEvidenceOrBetter: number;
  complianceGaps: ReadinessComplianceGap[];
  auditChain: { intact: boolean; count: number; brokenAt: number };
}

export interface ReadinessContribution {
  dimension: AuditReadinessDimension;
  max: number;
  awarded: number;
  rationale: string;
}

export interface ReadinessIssue {
  kind: AuditIssueKind;
  severity: FindingSeverity;
  subjectType: string;
  subjectId: string;
  title: string;
  detail: string;
}

export interface ReadinessAssessment {
  value: number;
  band: TrustBand;
  modelVersion: string;
  breakdown: ReadinessContribution[];
  issues: ReadinessIssue[];
}

function pct(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

export function assessReadiness(input: ReadinessInput): ReadinessAssessment {
  const issues: ReadinessIssue[] = [];
  const dp = input.datapoints;
  const calcs = input.calculations;

  // --- evidence_verified -------------------------------------------------
  const verified = dp.filter((d) => d.liveVerifiedEvidence > 0).length;
  for (const d of dp) {
    if (d.liveVerifiedEvidence > 0) continue;
    if (d.liveEvidence > 0) {
      issues.push({
        kind: 'unverified_evidence',
        severity: 'warning',
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        title: `${d.metricKey}: evidence not verified`,
        detail: `${d.liveEvidence} linked evidence record(s), none verified by a permissioned reviewer.`,
      });
    } else if (d.expiredEvidence > 0) {
      issues.push({
        kind: 'expired_evidence',
        severity: 'warning',
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        title: `${d.metricKey}: all evidence expired`,
        detail: `${d.expiredEvidence} linked evidence record(s), all past their expiry date.`,
      });
    } else {
      issues.push({
        kind: 'datapoint_without_lineage',
        severity: 'warning',
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        title: `${d.metricKey}: no supporting evidence`,
        detail: 'This datapoint has no linked evidence — it is not defensible in an audit.',
      });
    }
  }

  // --- calculations_reproducible --------------------------------------------
  const reproduced = calcs.filter((c) => c.reproduced).length;
  for (const c of calcs) {
    if (!c.reproduced) {
      issues.push({
        kind: 'unreproducible_calculation',
        severity: 'critical',
        subjectType: 'calculation',
        subjectId: c.id,
        title: `Calculation ${c.id.slice(0, 8)} does not reproduce`,
        detail: `Re-running the engine on the stored inputs did not match the stored result (${c.scope}).`,
      });
    }
  }

  // --- calculations_approved -----------------------------------------------
  const approved = calcs.filter((c) => c.approved).length;
  for (const c of calcs) {
    if (!c.approved) {
      issues.push({
        kind: 'unapproved_calculation',
        severity: 'warning',
        subjectType: 'calculation',
        subjectId: c.id,
        title: `Calculation ${c.id.slice(0, 8)} is not approved`,
        detail: `No reviewer has approved this ${c.scope} calculation result.`,
      });
    }
  }

  // --- data_quality ------------------------------------------------------
  for (const q of input.openCriticalQualityIssues) {
    issues.push({
      kind: 'open_critical_quality_issue',
      severity: 'critical',
      subjectType: q.subjectType,
      subjectId: q.subjectId,
      title: q.title,
      detail: 'Open critical data-quality issue — resolve before relying on this number.',
    });
  }
  const dqPenalty = 3 * input.openCriticalQualityIssues.length + input.openWarningQualityIssueCount;
  const dqAwarded = Math.max(0, READINESS_WEIGHTS.data_quality - dqPenalty);

  // --- trust_level -----------------------------------------------------
  const scores = dp.map((d) => d.trustScore).filter((s): s is number => s != null);
  const meanTrust = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  for (const d of dp) {
    if (d.trustScore != null && d.trustScore < LOW_TRUST_THRESHOLD) {
      issues.push({
        kind: 'low_trust_datapoint',
        severity: 'warning',
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        title: `${d.metricKey}: low Trust Score (${d.trustScore})`,
        detail: `Below ${LOW_TRUST_THRESHOLD}. Improve provenance, evidence or factor quality.`,
      });
    }
  }

  // --- compliance_mapping --------------------------------------------------
  for (const g of input.complianceGaps) {
    const reviewing = g.status === 'review_required';
    issues.push({
      kind: reviewing ? 'compliance_review_required' : 'compliance_gap',
      severity: 'warning',
      subjectType: 'disclosure',
      subjectId: g.disclosureCode,
      title: `${g.disclosureCode} / ${g.requiredDatapointKey}: ${g.status.replace(/_/g, ' ')}`,
      detail: g.title,
    });
  }

  // --- audit_trail_integrity ---------------------------------------------
  if (!input.auditChain.intact) {
    issues.push({
      kind: 'broken_audit_chain',
      severity: 'critical',
      subjectType: 'organization',
      subjectId: 'organization',
      title: 'Audit-log hash chain does not verify',
      detail: `The chain breaks at entry ${input.auditChain.brokenAt} of ${input.auditChain.count}.`,
    });
  }

  const breakdown: ReadinessContribution[] = [
    {
      dimension: 'evidence_verified',
      max: READINESS_WEIGHTS.evidence_verified,
      awarded: dp.length
        ? Math.round(READINESS_WEIGHTS.evidence_verified * pct(verified, dp.length))
        : READINESS_WEIGHTS.evidence_verified,
      rationale: dp.length
        ? `${verified}/${dp.length} material datapoints have verified, current evidence`
        : 'no material datapoints to assess',
    },
    {
      dimension: 'calculations_reproducible',
      max: READINESS_WEIGHTS.calculations_reproducible,
      awarded: calcs.length
        ? Math.round(READINESS_WEIGHTS.calculations_reproducible * pct(reproduced, calcs.length))
        : READINESS_WEIGHTS.calculations_reproducible,
      rationale: calcs.length
        ? `${reproduced}/${calcs.length} current calculations reproduce bit-for-bit`
        : 'no calculations to assess',
    },
    {
      dimension: 'calculations_approved',
      max: READINESS_WEIGHTS.calculations_approved,
      awarded: calcs.length
        ? Math.round(READINESS_WEIGHTS.calculations_approved * pct(approved, calcs.length))
        : READINESS_WEIGHTS.calculations_approved,
      rationale: calcs.length
        ? `${approved}/${calcs.length} current calculations have a recorded approver`
        : 'no calculations to assess',
    },
    {
      dimension: 'data_quality',
      max: READINESS_WEIGHTS.data_quality,
      awarded: dqAwarded,
      rationale: `${input.openCriticalQualityIssues.length} open critical, ${input.openWarningQualityIssueCount} open warning data-quality issues`,
    },
    {
      dimension: 'trust_level',
      max: READINESS_WEIGHTS.trust_level,
      awarded:
        meanTrust == null ? 0 : Math.min(READINESS_WEIGHTS.trust_level, Math.round(meanTrust / 10)),
      rationale:
        meanTrust == null ? 'no Trust Scores computed' : `mean Trust Score ${meanTrust.toFixed(1)}`,
    },
    {
      dimension: 'compliance_mapping',
      max: READINESS_WEIGHTS.compliance_mapping,
      awarded:
        input.complianceRequiredTotal === 0
          ? 0
          : Math.round(
              READINESS_WEIGHTS.compliance_mapping *
                pct(input.complianceEvidenceOrBetter, input.complianceRequiredTotal),
            ),
      rationale:
        input.complianceRequiredTotal === 0
          ? 'no rule store evaluated'
          : `${input.complianceEvidenceOrBetter}/${input.complianceRequiredTotal} required datapoints at evidence_available or better`,
    },
    {
      dimension: 'audit_trail_integrity',
      max: READINESS_WEIGHTS.audit_trail_integrity,
      awarded: input.auditChain.intact ? READINESS_WEIGHTS.audit_trail_integrity : 0,
      rationale: input.auditChain.intact
        ? `hash chain verifies (${input.auditChain.count} entries)`
        : 'hash chain does not verify',
    },
  ];

  const clamped = AUDIT_READINESS_DIMENSION.map((name) => {
    const c = breakdown.find((x) => x.dimension === name)!;
    return { ...c, awarded: Math.max(0, Math.min(c.max, Math.round(c.awarded))) };
  });
  const value = clamped.reduce((a, c) => a + c.awarded, 0);

  return {
    value,
    band: trustBand(value),
    modelVersion: AUDIT_READINESS_MODEL_VERSION,
    breakdown: clamped,
    issues,
  };
}
