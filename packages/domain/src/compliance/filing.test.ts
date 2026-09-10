import { describe, expect, it } from 'vitest';
import {
  assembleFiling,
  classifyFilingDatapoint,
  FILING_DISCLAIMER,
  FILING_FORMAT_VERSION,
  renderFilingHtml,
  type AssembleFilingInput,
  type FilingMappingInput,
  type FilingRequiredDatapoint,
} from './filing';

function evidence(over: Partial<{ status: string; type: string }> = {}) {
  return {
    id: 'ev1',
    type: over.type ?? 'utility_bill',
    title: 'FY25 electricity invoices',
    status: over.status ?? 'verified',
    hash: 'abc123',
  };
}
function mapping(over: Partial<FilingMappingInput> = {}): FilingMappingInput {
  return {
    status: 'mapping_complete',
    gapReasons: [],
    resolvedValue: 12840,
    resolvedValueText: null,
    trustScore: 82,
    confirmed: true,
    datapointIds: ['dp1'],
    calculationIds: ['calc1'],
    evidence: [evidence()],
    ...over,
  };
}
function rd(over: Partial<FilingRequiredDatapoint> = {}): FilingRequiredDatapoint {
  return {
    key: 'gross_scope_1',
    label: 'Gross Scope 1 GHG emissions',
    metricKey: 'emission_scope1',
    unit: 'tCO2e',
    cardinality: 'single',
    minTrustScore: 60,
    mapping: mapping(),
    ...over,
  };
}

function input(over: Partial<AssembleFilingInput> = {}): AssembleFilingInput {
  return {
    organization: { legalName: 'NordWerk AG', country: 'DE', baseCurrency: 'EUR' },
    regulation: {
      key: 'esrs_e1',
      name: 'ESRS E1 — Climate change',
      jurisdiction: 'EU',
      ruleStoreVersion: '2024.1',
      notice: 'Illustrative subset of ESRS E1.',
    },
    reportingPeriod: 'FY2025',
    auditChainIntact: true,
    generatedAt: '2026-01-01T00:00:00.000Z',
    generatedBy: 'user-1',
    requirements: [
      {
        code: 'E1-6',
        title: 'Gross Scopes 1, 2, 3 and Total GHG emissions',
        disclosures: [
          {
            code: 'E1-6-01',
            title: 'Gross Scope 1 GHG emissions',
            guidance: 'Report gross Scope 1 in tCO2e.',
            status: 'mapping_complete',
            requiredDatapoints: [rd()],
            evidenceRequirements: [
              { key: 'ev-s1', description: 'Fuel / utility records', acceptableTypes: ['utility_bill', 'invoice'] },
            ],
          },
        ],
      },
    ],
    ...over,
  };
}

describe('classifyFilingDatapoint', () => {
  it('reports a complete, trusted, evidenced, confirmed datapoint', () => {
    expect(classifyFilingDatapoint(rd()).resolution).toBe('reported');
  });
  it('flags a datapoint that is resolved but not confirmed', () => {
    expect(classifyFilingDatapoint(rd({ mapping: mapping({ confirmed: false }) })).resolution).toBe(
      'flagged',
    );
  });
  it('gaps a missing value, a below-trust value, and missing evidence', () => {
    expect(
      classifyFilingDatapoint(rd({ mapping: mapping({ resolvedValue: null }) })).resolution,
    ).toBe('gap');
    expect(
      classifyFilingDatapoint(rd({ mapping: mapping({ trustScore: 40 }) })).reasons,
    ).toEqual(['below_trust']);
    expect(
      classifyFilingDatapoint(rd({ mapping: mapping({ evidence: [evidence({ status: 'rejected' })] }) }))
        .reasons,
    ).toEqual(['no_acceptable_evidence']);
  });
  it('gaps a datapoint with no mapping at all', () => {
    expect(classifyFilingDatapoint(rd({ mapping: null })).reasons).toEqual(['no_mapping']);
  });
});

describe('assembleFiling', () => {
  it('is ready when every datapoint is reported and the chain verifies', () => {
    const f = assembleFiling(input());
    expect(f.formatVersion).toBe(FILING_FORMAT_VERSION);
    expect(f.readiness).toBe('ready');
    expect(f.blockers).toEqual([]);
    expect(f.stats).toMatchObject({ requiredDatapoints: 1, reported: 1, gaps: 0, flagged: 0 });
    expect(f.disclaimer).toBe(FILING_DISCLAIMER);
  });

  it('is blocked with a gap listed when a datapoint is missing', () => {
    const f = assembleFiling(
      input({
        requirements: [
          {
            code: 'E1-6',
            title: 'GHG emissions',
            disclosures: [
              {
                code: 'E1-6-01',
                title: 'Gross Scope 1',
                guidance: '',
                status: 'data_available',
                requiredDatapoints: [rd({ mapping: mapping({ resolvedValue: null, status: 'data_available', gapReasons: ['missing_data'] }) })],
                evidenceRequirements: [],
              },
            ],
          },
        ],
      }),
    );
    expect(f.readiness).toBe('blocked');
    expect(f.gaps).toHaveLength(1);
    expect(f.gaps[0]).toMatchObject({ disclosureCode: 'E1-6-01', datapointKey: 'gross_scope_1' });
    expect(f.blockers.some((b) => /gross_scope_1/.test(b))).toBe(true);
  });

  it('is blocked when the audit chain does not verify', () => {
    const f = assembleFiling(input({ auditChainIntact: false }));
    expect(f.readiness).toBe('blocked');
    expect(f.blockers[0]).toMatch(/audit-log chain/i);
  });

  it('is blocked (not ready) when a datapoint is only flagged', () => {
    const f = assembleFiling(
      input({
        requirements: [
          {
            code: 'E1-6',
            title: 'GHG emissions',
            disclosures: [
              {
                code: 'E1-6-01',
                title: 'Gross Scope 1',
                guidance: '',
                status: 'review_required',
                requiredDatapoints: [rd({ mapping: mapping({ confirmed: false, status: 'review_required' }) })],
                evidenceRequirements: [],
              },
            ],
          },
        ],
      }),
    );
    expect(f.readiness).toBe('blocked');
    expect(f.stats.flagged).toBe(1);
  });

  it('produces a stable digest that changes with the inputs', () => {
    const a = assembleFiling(input());
    const b = assembleFiling(input());
    const c = assembleFiling(input({ reportingPeriod: 'FY2024' }));
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('renderFilingHtml', () => {
  it('emits tagged HTML with lineage and the disclaimer, and never asserts compliance', () => {
    const html = renderFilingHtml(assembleFiling(input()));
    expect(html).toContain('data-esrs-filing');
    expect(html).toContain('data-datapoint="gross_scope_1"');
    expect(html).toContain('data-metric="emission_scope1"');
    expect(html).toContain('data-trust="82"');
    expect(html).toContain('data-evidence-id="ev1"');
    expect(html).toContain('data-audit-chain="intact"');
    expect(html).toContain(FILING_DISCLAIMER);
    // the document explicitly disclaims compliance; it must not assert it
    expect(html).toMatch(/does not assert conformity/);
    expect(html).not.toMatch(/\bis compliant\b/i);
  });
});
