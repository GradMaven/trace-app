import { describe, expect, it } from 'vitest';
import {
  QUALITY_RULES_VERSION,
  evaluateDatapointQuality,
  metricIsNonNegative,
  metricIsPercentage,
  type QualityContext,
  type QualityDatapoint,
} from './quality';

function dp(overrides: Partial<QualityDatapoint> = {}): QualityDatapoint {
  return {
    id: 'dp-1',
    metricKey: 'scope1_tco2e',
    valueNumeric: 1200,
    valueText: null,
    unit: 'tCO2e',
    unitResolves: true,
    provenance: 'supplier_reported',
    label: 'human_reviewed',
    reportingPeriod: 'FY2025',
    subjectType: 'supplier',
    subjectId: 'sup-1',
    createdAt: '2025-06-01T00:00:00.000Z',
    evidence: [{ status: 'verified', expiresAt: null, verified: true }],
    factor: null,
    methodology: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<QualityContext> = {}): QualityContext {
  return { now: '2025-09-08', staleAfterDays: 400, peers: [], ...overrides };
}

const kinds = (fs: { kind: string }[]) => fs.map((f) => f.kind).sort();

describe('evaluateDatapointQuality', () => {
  it('a clean datapoint produces no findings', () => {
    expect(evaluateDatapointQuality(dp(), ctx())).toEqual([]);
  });

  it('flags a missing value as critical', () => {
    const fs = evaluateDatapointQuality(dp({ valueNumeric: null, valueText: null }), ctx());
    const f = fs.find((x) => x.kind === 'missing_value');
    expect(f?.severity).toBe('critical');
  });

  it('flags a missing unit only for dimensional metrics', () => {
    expect(kinds(evaluateDatapointQuality(dp({ unit: null }), ctx()))).toContain('missing_unit');
    expect(
      kinds(
        evaluateDatapointQuality(
          dp({ metricKey: 'renewable_electricity_pct', unit: null, valueNumeric: 40 }),
          ctx(),
        ),
      ),
    ).not.toContain('missing_unit');
  });

  it('flags missing evidence, softer for measured data', () => {
    expect(
      evaluateDatapointQuality(dp({ evidence: [] }), ctx()).find(
        (f) => f.kind === 'missing_evidence',
      )?.severity,
    ).toBe('warning');
    expect(
      evaluateDatapointQuality(dp({ evidence: [], provenance: 'measured' }), ctx()).find(
        (f) => f.kind === 'missing_evidence',
      )?.severity,
    ).toBe('info');
  });

  it('flags evidence that is entirely expired', () => {
    const fs = evaluateDatapointQuality(
      dp({ evidence: [{ status: 'verified', expiresAt: '2025-01-01', verified: true }] }),
      ctx(),
    );
    expect(kinds(fs)).toContain('expired_evidence');
  });

  it('flags unverified evidence as info', () => {
    const fs = evaluateDatapointQuality(
      dp({
        label: 'human_reviewed',
        evidence: [{ status: 'reviewed', expiresAt: null, verified: false }],
      }),
      ctx(),
    );
    expect(fs.find((f) => f.kind === 'unverified_evidence')?.severity).toBe('info');
  });

  it('flags stale data past the freshness threshold', () => {
    const fs = evaluateDatapointQuality(dp({ createdAt: '2023-01-01T00:00:00.000Z' }), ctx());
    expect(kinds(fs)).toContain('stale_data');
  });

  it('flags unit inconsistency across peers', () => {
    const fs = evaluateDatapointQuality(
      dp(),
      ctx({
        peers: [
          {
            id: 'dp-2',
            metricKey: 'scope1_tco2e',
            subjectType: 'supplier',
            subjectId: 'sup-2',
            reportingPeriod: 'FY2025',
            valueNumeric: 5,
            unit: 'ktCO2e',
            provenance: 'supplier_reported',
          },
        ],
      }),
    );
    const f = fs.find((x) => x.kind === 'unit_inconsistency');
    expect(f?.facts.units).toEqual(['ktCO2e', 'tCO2e']);
  });

  it('flags impossible percentage and negative values as critical', () => {
    expect(
      evaluateDatapointQuality(
        dp({ metricKey: 'renewable_electricity_pct', unit: null, valueNumeric: 140 }),
        ctx(),
      ).find((f) => f.kind === 'impossible_value')?.severity,
    ).toBe('critical');
    expect(
      evaluateDatapointQuality(dp({ valueNumeric: -3 }), ctx()).find(
        (f) => f.kind === 'impossible_value',
      )?.severity,
    ).toBe('critical');
  });

  it('flags an unresolvable unit', () => {
    const fs = evaluateDatapointQuality(dp({ unit: 'sqiggles', unitResolves: false }), ctx());
    expect(kinds(fs)).toContain('impossible_value');
  });

  it('flags a duplicate against a near-identical peer', () => {
    const fs = evaluateDatapointQuality(
      dp(),
      ctx({
        peers: [
          {
            id: 'dp-9',
            metricKey: 'scope1_tco2e',
            subjectType: 'supplier',
            subjectId: 'sup-1',
            reportingPeriod: 'FY2025',
            valueNumeric: 1200.5,
            unit: 'tCO2e',
            provenance: 'calculated',
          },
        ],
      }),
    );
    expect(fs.find((f) => f.kind === 'duplicate')?.facts.peerId).toBe('dp-9');
  });

  it('flags conflicting supplier reports (>5% apart)', () => {
    const fs = evaluateDatapointQuality(
      dp({ valueNumeric: 1000 }),
      ctx({
        peers: [
          {
            id: 'dp-x',
            metricKey: 'scope1_tco2e',
            subjectType: 'supplier',
            subjectId: 'sup-1',
            reportingPeriod: 'FY2025',
            valueNumeric: 1300,
            unit: 'tCO2e',
            provenance: 'supplier_reported',
          },
        ],
      }),
    );
    expect(kinds(fs)).toContain('conflicting_supplier_report');
  });

  it('flags an emission factor past its validity window', () => {
    const fs = evaluateDatapointQuality(
      dp({
        metricKey: 'emission_scope_3_tco2e',
        factor: { recognisedSource: true, validTo: '2023-12-31', asOf: '2025-06-30' },
      }),
      ctx(),
    );
    const f = fs.find((x) => x.kind === 'outdated_factor');
    expect(f?.severity).toBe('warning');
  });

  it('flags spend-based methodology as low tier (info)', () => {
    const fs = evaluateDatapointQuality(dp({ methodology: 'spend_based' }), ctx());
    expect(fs.find((f) => f.kind === 'low_methodology_tier')?.severity).toBe('info');
  });

  it('exposes a version constant', () => {
    expect(QUALITY_RULES_VERSION).toMatch(/^quality-rules@/);
  });
});

describe('metric helpers', () => {
  it('classifies percentages and non-negative metrics', () => {
    expect(metricIsPercentage('renewable_electricity_pct')).toBe(true);
    expect(metricIsNonNegative('emission_scope_1_tco2e')).toBe(true);
    expect(metricIsNonNegative('energy_consumption_mwh')).toBe(true);
    expect(metricIsNonNegative('board_diversity_ratio')).toBe(false);
  });
});
