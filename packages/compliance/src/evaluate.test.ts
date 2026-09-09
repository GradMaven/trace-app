import { describe, expect, it } from 'vitest';
import {
  evaluateRequiredDatapoint,
  evaluateRuleStore,
  type CandidateDatapoint,
  type RequiredDatapointInput,
} from './evaluate';
import { getRuleStore, type RequiredDatapoint } from './rule-store';
import './index';

const NOW = '2026-01-15';

function rd(overrides: Partial<RequiredDatapoint> = {}): RequiredDatapoint {
  return {
    key: 'test_rd',
    metricKey: 'emission_scope_1_tco2e',
    unit: 'tCO2e',
    cardinality: 'single',
    subjectScope: 'organization',
    label: 'Test',
    minTrustScore: 60,
    ...overrides,
  };
}

function cand(overrides: Partial<CandidateDatapoint> = {}): CandidateDatapoint {
  return {
    id: 'dp-1',
    subjectType: 'organization',
    valueNumeric: 100,
    valueText: null,
    unit: 'tCO2e',
    reportingPeriod: 'FY2025',
    calculationId: 'calc-1',
    createdAt: '2025-06-01T00:00:00.000Z',
    trustScore: 80,
    evidence: [],
    factorOutdated: false,
    ...overrides,
  };
}

function input(candidates: CandidateDatapoint[], confirmed = false): RequiredDatapointInput {
  return { candidates, confirmed };
}

describe('evaluateRequiredDatapoint — status ladder', () => {
  it('not_started when there is no candidate data', () => {
    const r = evaluateRequiredDatapoint(rd(), input([]), NOW);
    expect(r.status).toBe('not_started');
    expect(r.gapReasons).toContain('missing_data');
  });

  it('data_available when data exists but no evidence', () => {
    const r = evaluateRequiredDatapoint(rd(), input([cand({ evidence: [] })]), NOW);
    expect(r.status).toBe('data_available');
    expect(r.gapReasons).toContain('no_evidence');
    expect(r.value).toBe(100);
  });

  it('evidence_available with live evidence but no confirmed mapping', () => {
    const r = evaluateRequiredDatapoint(
      rd(),
      input([cand({ evidence: [{ id: 'ev-1', status: 'verified', expiresAt: null }] })]),
      NOW,
    );
    expect(r.status).toBe('evidence_available');
    expect(r.gapReasons).toContain('unconfirmed_mapping');
    expect(r.evidenceIds).toEqual(['ev-1']);
  });

  it('mapping_complete with live evidence, confirmed mapping and trust above threshold', () => {
    const r = evaluateRequiredDatapoint(
      rd(),
      input(
        [cand({ trustScore: 72, evidence: [{ id: 'ev-1', status: 'verified', expiresAt: null }] })],
        true,
      ),
      NOW,
    );
    expect(r.status).toBe('mapping_complete');
    expect(r.gapReasons).toEqual([]);
  });

  it('stays evidence_available (low_trust_score) when confirmed but trust is below threshold', () => {
    const r = evaluateRequiredDatapoint(
      rd(),
      input(
        [cand({ trustScore: 40, evidence: [{ id: 'ev-1', status: 'verified', expiresAt: null }] })],
        true,
      ),
      NOW,
    );
    expect(r.status).toBe('evidence_available');
    expect(r.gapReasons).toContain('low_trust_score');
  });
});

describe('evaluateRequiredDatapoint — review_required overrides', () => {
  it('conflicting single-value candidates', () => {
    const r = evaluateRequiredDatapoint(
      rd(),
      input([cand({ id: 'a', valueNumeric: 100 }), cand({ id: 'b', valueNumeric: 250 })]),
      NOW,
    );
    expect(r.status).toBe('review_required');
    expect(r.gapReasons).toContain('conflicting_data');
    expect(r.value).toBeNull();
  });

  it('all evidence expired', () => {
    const r = evaluateRequiredDatapoint(
      rd(),
      input([cand({ evidence: [{ id: 'ev-1', status: 'verified', expiresAt: '2025-01-01' }] })]),
      NOW,
    );
    expect(r.status).toBe('review_required');
    expect(r.gapReasons).toContain('expired_evidence');
  });

  it('outdated emission factor', () => {
    const r = evaluateRequiredDatapoint(
      rd(),
      input([
        cand({
          factorOutdated: true,
          evidence: [{ id: 'ev-1', status: 'verified', expiresAt: null }],
        }),
      ]),
      NOW,
    );
    expect(r.status).toBe('review_required');
    expect(r.gapReasons).toContain('outdated_factor');
  });

  it('unit mismatch against the required unit', () => {
    const r = evaluateRequiredDatapoint(
      rd({ unit: 'tCO2e' }),
      input([
        cand({ unit: 'kg', evidence: [{ id: 'ev-1', status: 'verified', expiresAt: null }] }),
      ]),
      NOW,
    );
    expect(r.status).toBe('review_required');
    expect(r.gapReasons).toContain('unit_mismatch');
  });
});

describe('evaluateRequiredDatapoint — aggregation', () => {
  it('sums additive contributions (e.g. Scope 1 = fuel + fleet)', () => {
    const r = evaluateRequiredDatapoint(
      rd({ aggregation: 'sum', cardinality: 'multiple' }),
      input([
        cand({ id: 'a', valueNumeric: 820, trustScore: 70 }),
        cand({ id: 'b', valueNumeric: 483, trustScore: 65 }),
      ]),
      NOW,
    );
    expect(r.value).toBe(1303);
    expect(r.datapointIds).toEqual(['a', 'b']);
    expect(r.trustScore).toBe(65); // min across contributors
  });

  it('treats "%" and "pct" units as matching', () => {
    const r = evaluateRequiredDatapoint(
      rd({ metricKey: 'renewable_electricity_pct', unit: '%', subjectScope: 'any' }),
      input([
        cand({
          unit: 'pct',
          valueNumeric: 48,
          evidence: [{ id: 'e', status: 'verified', expiresAt: null }],
        }),
      ]),
      NOW,
    );
    expect(r.gapReasons).not.toContain('unit_mismatch');
  });

  it('respects subjectScope=organization by preferring org-subject candidates', () => {
    const r = evaluateRequiredDatapoint(
      rd(),
      input([
        cand({ id: 'org', subjectType: 'organization', valueNumeric: 100 }),
        cand({ id: 'sup', subjectType: 'supplier', valueNumeric: 999 }),
      ]),
      NOW,
    );
    expect(r.datapointIds).toEqual(['org']);
    expect(r.value).toBe(100);
  });
});

describe('evaluateRuleStore', () => {
  it('evaluates the ESRS store and rolls disclosures up', () => {
    const store = getRuleStore('esrs@2026.1');
    const result = evaluateRuleStore(
      store,
      {
        esrs_e1_6_scope_1: input(
          [cand({ trustScore: 70, evidence: [{ id: 'e1', status: 'verified', expiresAt: null }] })],
          true,
        ),
      },
      NOW,
    );
    const e16 = result.disclosures.find((d) => d.disclosureCode === 'E1-6')!;
    // One datapoint mapped, the rest of E1-6 still missing → disclosure not_started.
    expect(e16.status).toBe('not_started');
    const scope1 = result.requiredDatapoints.find(
      (r) => r.requiredDatapointKey === 'esrs_e1_6_scope_1',
    )!;
    expect(scope1.status).toBe('mapping_complete');
    expect(result.readinessPct).toBeGreaterThan(0);
    expect(result.requiredDatapoints).toHaveLength(9);
  });
});
