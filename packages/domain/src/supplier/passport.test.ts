import { describe, expect, it } from 'vitest';
import { buildPassport, type PassportInput } from './passport';

function baseInput(overrides: Partial<PassportInput> = {}): PassportInput {
  return {
    supplier: { name: 'XYZ GmbH', country: 'DE', industryNace: '24.10', status: 'active' },
    relationship: { category: 'Raw materials', tier: 1, annualSpend: '18400000.00', currency: 'EUR' },
    questionnaire: {
      version: 'supplier-sustainability@1',
      submittedAt: '2026-02-01T00:00:00.000Z',
      responses: {
        reporting_period: 'FY2025',
        primary_activity: 'Steel production',
        ghg_inventory_exists: true,
        scope1_tco2e: 1283,
        scope2_method: 'market_based',
        scope2_tco2e: 410,
        scope3_categories_reported: ['cat1', 'cat4'],
        renewable_electricity_pct: 62,
        reduction_target: true,
        iso14001: true,
        human_rights_policy: true,
        code_of_conduct: true,
        anti_corruption_policy: true,
        sustainability_contact: 'Sara Lind, sara@xyz.example',
      },
    },
    evidence: { count: 2, verifiedCount: 1, latestReportingPeriod: 'FY2025' },
    ...overrides,
  };
}

describe('buildPassport', () => {
  it('marks questionnaire figures as supplier_reported', () => {
    const p = buildPassport(baseInput());
    expect(p.carbon.scope1).toEqual({ value: 1283, provenance: 'supplier_reported', unit: 'tCO2e' });
    expect(p.carbon.scope3Categories.value).toEqual(['cat1', 'cat4']);
    expect(p.governance.codeOfConduct.value).toBe(true);
  });

  it('marks annual spend (from the customer relationship) as measured', () => {
    const p = buildPassport(baseInput());
    expect(p.relationship.annualSpend.provenance).toBe('measured');
    expect(p.relationship.annualSpend.unit).toBe('EUR');
  });

  it('reports not_provided for absent fields and when there is no questionnaire', () => {
    const p = buildPassport(baseInput({ questionnaire: null }));
    expect(p.completeness).toBe(0);
    expect(p.carbon.scope1.provenance).toBe('not_provided');
    expect(p.carbon.scope1.value).toBeNull();
    expect(p.questionnaireVersion).toBeNull();
  });

  it('computes completeness from the questionnaire responses', () => {
    const full = buildPassport(baseInput());
    expect(full.completeness).toBeGreaterThan(50);
  });

  it('passes evidence counts through', () => {
    const p = buildPassport(baseInput());
    expect(p.evidence).toEqual({ attached: 2, verified: 1, latestReportingPeriod: 'FY2025' });
  });
});
