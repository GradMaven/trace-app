import { describe, expect, it } from 'vitest';
import {
  AUDIT_READINESS_MODEL_VERSION,
  READINESS_MAX,
  assessReadiness,
  type ReadinessInput,
} from './readiness';

function input(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    reportingPeriod: 'FY2025',
    datapoints: [
      {
        id: 'dp-1',
        metricKey: 'emission_scope_1_tco2e',
        subjectType: 'organization',
        subjectId: 'org',
        hasCalculation: true,
        liveVerifiedEvidence: 1,
        liveEvidence: 1,
        expiredEvidence: 0,
        trustScore: 90,
      },
    ],
    calculations: [
      {
        id: 'calc-1',
        scope: 'scope_1',
        reportingPeriod: 'FY2025',
        reproduced: true,
        approved: true,
      },
    ],
    openCriticalQualityIssues: [],
    openWarningQualityIssueCount: 0,
    complianceRequiredTotal: 4,
    complianceEvidenceOrBetter: 4,
    complianceGaps: [],
    auditChain: { intact: true, count: 40, brokenAt: -1 },
    ...overrides,
  };
}

describe('assessReadiness', () => {
  it('a fully verified, reproducible, approved, mapped org scores 100', () => {
    const r = assessReadiness(
      input({
        datapoints: [
          {
            id: 'dp-1',
            metricKey: 'emission_scope_1_tco2e',
            subjectType: 'organization',
            subjectId: 'org',
            hasCalculation: true,
            liveVerifiedEvidence: 1,
            liveEvidence: 1,
            expiredEvidence: 0,
            trustScore: 100,
          },
        ],
      }),
    );
    expect(r.value).toBe(100);
    expect(r.value).toBe(READINESS_MAX);
    expect(r.band).toBe('high');
    expect(r.modelVersion).toBe(AUDIT_READINESS_MODEL_VERSION);
    expect(r.issues).toEqual([]);
  });

  it('breakdown awards never exceed their max and sum to the value', () => {
    const r = assessReadiness(
      input({
        datapoints: [
          {
            id: 'dp-1',
            metricKey: 'x_tco2e',
            subjectType: 'organization',
            subjectId: 'org',
            hasCalculation: false,
            liveVerifiedEvidence: 0,
            liveEvidence: 0,
            expiredEvidence: 0,
            trustScore: 20,
          },
        ],
        calculations: [
          {
            id: 'c1',
            scope: 'scope_1',
            reportingPeriod: 'FY2025',
            reproduced: false,
            approved: false,
          },
        ],
        openCriticalQualityIssues: [
          { id: 'q1', subjectType: 'organization', subjectId: 'org', metricKey: 'x', title: 'bad' },
        ],
        complianceEvidenceOrBetter: 1,
        auditChain: { intact: false, count: 10, brokenAt: 4 },
      }),
    );
    for (const c of r.breakdown) {
      expect(c.awarded).toBeGreaterThanOrEqual(0);
      expect(c.awarded).toBeLessThanOrEqual(c.max);
    }
    expect(r.breakdown.reduce((a, c) => a + c.awarded, 0)).toBe(r.value);
    expect(r.band).toBe('low');
  });

  it('raises a critical finding for an unreproducible calculation', () => {
    const r = assessReadiness(
      input({
        calculations: [
          {
            id: 'c1',
            scope: 'scope_3',
            reportingPeriod: 'FY2025',
            reproduced: false,
            approved: true,
          },
        ],
      }),
    );
    const f = r.issues.find((i) => i.kind === 'unreproducible_calculation');
    expect(f?.severity).toBe('critical');
    expect(f?.subjectId).toBe('c1');
    expect(r.breakdown.find((c) => c.dimension === 'calculations_reproducible')!.awarded).toBe(0);
  });

  it('raises a warning for an unapproved calculation', () => {
    const r = assessReadiness(
      input({
        calculations: [
          {
            id: 'c1',
            scope: 'scope_1',
            reportingPeriod: 'FY2025',
            reproduced: true,
            approved: false,
          },
        ],
      }),
    );
    expect(r.issues.find((i) => i.kind === 'unapproved_calculation')?.severity).toBe('warning');
  });

  it('classifies evidence gaps: unverified vs expired vs none', () => {
    const mk = (over: Partial<ReadinessInput['datapoints'][number]>) => ({
      id: 'dp',
      metricKey: 'm_tco2e',
      subjectType: 'supplier',
      subjectId: 's1',
      hasCalculation: false,
      liveVerifiedEvidence: 0,
      liveEvidence: 0,
      expiredEvidence: 0,
      trustScore: 70,
      ...over,
    });
    expect(assessReadiness(input({ datapoints: [mk({ liveEvidence: 2 })] })).issues[0]!.kind).toBe(
      'unverified_evidence',
    );
    expect(
      assessReadiness(input({ datapoints: [mk({ expiredEvidence: 1 })] })).issues[0]!.kind,
    ).toBe('expired_evidence');
    expect(assessReadiness(input({ datapoints: [mk({})] })).issues[0]!.kind).toBe(
      'datapoint_without_lineage',
    );
  });

  it('penalises data quality by open issues and flags criticals', () => {
    const r = assessReadiness(
      input({
        openCriticalQualityIssues: [
          {
            id: 'q1',
            subjectType: 'supplier',
            subjectId: 's1',
            metricKey: 'm',
            title: 'impossible value',
          },
        ],
        openWarningQualityIssueCount: 2,
      }),
    );
    // 15 - (3*1 + 2) = 10
    expect(r.breakdown.find((c) => c.dimension === 'data_quality')!.awarded).toBe(10);
    expect(
      r.issues.some((i) => i.kind === 'open_critical_quality_issue' && i.severity === 'critical'),
    ).toBe(true);
  });

  it('flags a broken audit chain as critical and zeroes the integrity dimension', () => {
    const r = assessReadiness(input({ auditChain: { intact: false, count: 12, brokenAt: 7 } }));
    expect(r.breakdown.find((c) => c.dimension === 'audit_trail_integrity')!.awarded).toBe(0);
    expect(r.issues.find((i) => i.kind === 'broken_audit_chain')?.severity).toBe('critical');
  });

  it('turns compliance gaps into findings', () => {
    const r = assessReadiness(
      input({
        complianceEvidenceOrBetter: 2,
        complianceGaps: [
          {
            requiredDatapointKey: 'esrs_e1_5_energy_total',
            disclosureCode: 'E1-5',
            status: 'not_started',
            title: 'Total energy',
          },
          {
            requiredDatapointKey: 'esrs_e1_6_scope_1',
            disclosureCode: 'E1-6',
            status: 'review_required',
            title: 'Scope 1',
          },
        ],
      }),
    );
    expect(r.issues.filter((i) => i.kind === 'compliance_gap')).toHaveLength(1);
    expect(r.issues.filter((i) => i.kind === 'compliance_review_required')).toHaveLength(1);
    expect(r.breakdown.find((c) => c.dimension === 'compliance_mapping')!.awarded).toBe(5); // 10 * 2/4
  });

  it('is deterministic', () => {
    expect(assessReadiness(input())).toEqual(assessReadiness(input()));
  });
});
