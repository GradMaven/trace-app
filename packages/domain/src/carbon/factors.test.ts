import { describe, expect, it } from 'vitest';
import { selectEmissionFactor, type FactorCandidate } from './factors';

function factor(overrides: Partial<FactorCandidate>): FactorCandidate {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    organizationId: null,
    source: 'TRACE-DEMO',
    sourceRef: 'steel',
    version: 1,
    numeratorUnit: 'kgCO2e',
    denominatorUnit: 'kg',
    gwpSet: 'AR6',
    scope: 'scope_3',
    ghgCategory: 'cat_1_purchased_goods_services',
    geography: null,
    methodology: 'average_data',
    validFrom: '2024-01-01',
    validTo: null,
    ...overrides,
  };
}

describe('selectEmissionFactor', () => {
  it('returns null when nothing matches the dimension', () => {
    const result = selectEmissionFactor([factor({ denominatorUnit: 'kWh' })], {
      activityUnit: 'kg',
      scope: 'scope_3',
      asOf: '2025-06-01',
    });
    expect(result).toBeNull();
  });

  it('prefers an organization-specific factor over the shared library', () => {
    const lib = factor({ id: 'lib' });
    const own = factor({ id: 'own', organizationId: 'org_1' });
    const result = selectEmissionFactor([lib, own], {
      activityUnit: 'kg',
      scope: 'scope_3',
      asOf: '2025-06-01',
    });
    expect(result?.factor.id).toBe('own');
    expect(result?.reasons.join(' ')).toMatch(/organization-specific/);
  });

  it('prefers a geography and methodology match', () => {
    const generic = factor({ id: 'generic' });
    const de = factor({ id: 'de', geography: 'DE', methodology: 'supplier_specific' });
    const result = selectEmissionFactor([generic, de], {
      activityUnit: 'kg',
      scope: 'scope_3',
      geography: 'DE',
      methodologyPreference: 'supplier_specific',
      asOf: '2025-06-01',
    });
    expect(result?.factor.id).toBe('de');
  });

  it('excludes factors outside their validity window', () => {
    const expired = factor({ id: 'old', validFrom: '2020-01-01', validTo: '2022-12-31' });
    const current = factor({ id: 'cur', validFrom: '2024-01-01' });
    const result = selectEmissionFactor([expired, current], {
      activityUnit: 'kg',
      scope: 'scope_3',
      asOf: '2025-06-01',
    });
    expect(result?.factor.id).toBe('cur');
  });

  it('excludes a mismatched geography (non-null, different)', () => {
    const fr = factor({ id: 'fr', geography: 'FR' });
    const result = selectEmissionFactor([fr], {
      activityUnit: 'kg',
      scope: 'scope_3',
      geography: 'DE',
      asOf: '2025-06-01',
    });
    expect(result).toBeNull();
  });
});
