import { describe, expect, it } from 'vitest';
import {
  TRUST_MAX,
  TRUST_MODEL_VERSION,
  scoreDatapoint,
  periodYear,
  type TrustInput,
} from './model';

function baseInput(overrides: Partial<TrustInput> = {}): TrustInput {
  return {
    provenance: 'measured',
    label: 'verified',
    unit: 'tCO2e',
    unitResolves: true,
    valuePresent: true,
    methodology: null,
    reportingPeriod: 'FY2025',
    activeReportingPeriod: 'FY2025',
    evidence: [{ status: 'verified', expiresAt: null, verified: true }],
    factor: null,
    companionFields: [],
    ...overrides,
  };
}

describe('scoreDatapoint', () => {
  it('gives a fully primary, verified, evidenced, in-period datapoint a perfect score', () => {
    const r = scoreDatapoint(baseInput());
    expect(r.value).toBe(100);
    expect(r.value).toBe(TRUST_MAX);
    expect(r.band).toBe('high');
    expect(r.modelVersion).toBe(TRUST_MODEL_VERSION);
  });

  it('breakdown awards never exceed their maximum and sum to the value', () => {
    const r = scoreDatapoint(
      baseInput({
        provenance: 'estimated',
        label: 'ai_extracted',
        evidence: [],
        methodology: 'spend_based',
        reportingPeriod: 'FY2021',
      }),
    );
    for (const c of r.breakdown) {
      expect(c.awarded).toBeGreaterThanOrEqual(0);
      expect(c.awarded).toBeLessThanOrEqual(c.max);
    }
    expect(r.breakdown.reduce((a, c) => a + c.awarded, 0)).toBe(r.value);
  });

  it('is deterministic', () => {
    const a = scoreDatapoint(baseInput({ provenance: 'calculated' }));
    const b = scoreDatapoint(baseInput({ provenance: 'calculated' }));
    expect(a).toEqual(b);
  });

  it('scores a weak datapoint low', () => {
    const r = scoreDatapoint(
      baseInput({
        provenance: 'inferred',
        label: 'ai_extracted',
        unit: 'widgets',
        unitResolves: false,
        evidence: [],
        methodology: 'spend_based',
        reportingPeriod: 'FY2020',
        activeReportingPeriod: 'FY2025',
        companionFields: [
          { key: 'unit', present: false },
          { key: 'reportingPeriod', present: true },
        ],
      }),
    );
    expect(r.value).toBeLessThan(30);
    expect(r.band).toBe('low');
  });

  it('does not penalise a direct datapoint for having no emission factor', () => {
    const r = scoreDatapoint(baseInput({ factor: null }));
    const fq = r.breakdown.find((c) => c.dimension === 'factor_quality')!;
    expect(fq.awarded).toBe(fq.max);
  });

  it('rewards a recognised, in-validity, matching-GWP factor and penalises otherwise', () => {
    const good = scoreDatapoint(
      baseInput({
        provenance: 'calculated',
        factor: {
          recognisedSource: true,
          validFrom: '2024-01-01',
          validTo: '2026-12-31',
          gwpSet: 'AR6',
          expectedGwpSet: 'AR6',
          asOf: '2025-06-30',
        },
      }),
    );
    const bad = scoreDatapoint(
      baseInput({
        provenance: 'calculated',
        factor: {
          recognisedSource: false,
          validFrom: '2010-01-01',
          validTo: '2015-12-31',
          gwpSet: 'AR4',
          expectedGwpSet: 'AR6',
          asOf: '2025-06-30',
        },
      }),
    );
    const g = good.breakdown.find((c) => c.dimension === 'factor_quality')!;
    const b = bad.breakdown.find((c) => c.dimension === 'factor_quality')!;
    expect(g.awarded).toBe(15);
    expect(b.awarded).toBe(0);
  });

  it('steps down period freshness as the reporting period ages', () => {
    const yr = (p: string) =>
      scoreDatapoint(
        baseInput({ reportingPeriod: p, activeReportingPeriod: 'FY2025' }),
      ).breakdown.find((c) => c.dimension === 'period_freshness')!.awarded;
    expect(yr('FY2025')).toBe(9);
    expect(yr('FY2024')).toBe(5);
    expect(yr('FY2023')).toBe(2);
    expect(yr('FY2019')).toBe(0);
  });

  it('scores completeness as the fraction of companion fields present', () => {
    const r = scoreDatapoint(
      baseInput({
        companionFields: [
          { key: 'a', present: true },
          { key: 'b', present: true },
          { key: 'c', present: false },
        ],
      }),
    );
    const c = r.breakdown.find((x) => x.dimension === 'completeness')!;
    expect(c.awarded).toBe(4); // round(2/3 * 6)
    expect(c.rationale).toContain('c');
  });
});

describe('periodYear', () => {
  it('extracts the trailing year from common period labels', () => {
    expect(periodYear('FY2025')).toBe(2025);
    expect(periodYear('2024')).toBe(2024);
    expect(periodYear('2023-Q4')).toBe(2023);
    expect(periodYear(null)).toBeNull();
    expect(periodYear('no-year')).toBeNull();
  });
});
