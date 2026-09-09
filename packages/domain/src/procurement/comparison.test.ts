import { describe, expect, it } from 'vitest';
import { compareSuppliers, type SupplierComparisonInput } from './comparison';

function s(over: Partial<SupplierComparisonInput> = {}): SupplierComparisonInput {
  return {
    supplierId: 's1',
    name: 'Supplier One',
    country: 'DE',
    category: 'Steel',
    tier: 1,
    annualSpendEur: 1_000_000,
    emissionsTco2e: 500,
    provenance: 'calculated',
    methodology: 'spend_based',
    trustScore: 60,
    hasPassport: false,
    ...over,
  };
}

describe('compareSuppliers', () => {
  it('computes carbon intensity per €1k of spend', () => {
    const r = compareSuppliers([s({ emissionsTco2e: 500, annualSpendEur: 1_000_000 })], 'FY2025');
    // 500 tCO2e / (1,000,000 / 1000) = 0.5 tCO2e per €1k
    expect(r.rows[0]!.carbonIntensityPerKEur).toBe(0.5);
  });

  it('ranks by carbon intensity (worst first) and computes shares', () => {
    const r = compareSuppliers(
      [
        s({ supplierId: 'a', name: 'A', emissionsTco2e: 300, annualSpendEur: 1_000_000 }), // 0.3
        s({ supplierId: 'b', name: 'B', emissionsTco2e: 900, annualSpendEur: 1_000_000 }), // 0.9
        s({ supplierId: 'c', name: 'C', emissionsTco2e: 600, annualSpendEur: 1_000_000 }), // 0.6
      ],
      'FY2025',
    );
    expect(r.rows.map((x) => x.name)).toEqual(['B', 'C', 'A']);
    expect(r.rows.find((x) => x.name === 'B')!.intensityRank).toBe(1);
    expect(r.totals.totalEmissionsTco2e).toBe(1800);
    expect(r.rows.find((x) => x.name === 'B')!.emissionsSharePct).toBe(50);
    expect(r.totals.medianIntensityPerKEur).toBe(0.6);
  });

  it('flags spend-based estimates, missing passports and low Trust', () => {
    const r = compareSuppliers(
      [s({ methodology: 'spend_based', hasPassport: false, trustScore: 40 })],
      'FY2025',
    );
    const flags = r.rows[0]!.flags;
    expect(flags).toContain('spend-based estimate');
    expect(flags).toContain('no supplier passport');
    expect(flags).toContain('low Trust Score');
    expect(r.rows[0]!.attributionQuality).toBe('spend_based');
  });

  it('leaves suppliers with no emissions unranked and at the bottom', () => {
    const r = compareSuppliers(
      [
        s({ supplierId: 'a', name: 'A', emissionsTco2e: 100 }),
        s({ supplierId: 'z', name: 'Z', emissionsTco2e: null, methodology: null }),
      ],
      'FY2025',
    );
    expect(r.rows[r.rows.length - 1]!.name).toBe('Z');
    expect(r.rows.find((x) => x.name === 'Z')!.intensityRank).toBeNull();
    expect(r.rows.find((x) => x.name === 'Z')!.attributionQuality).toBe('none');
    expect(r.totals.withEmissions).toBe(1);
  });

  it('proposes a quantified reduction for an above-median-intensity supplier', () => {
    const r = compareSuppliers(
      [
        s({
          supplierId: 'hi',
          name: 'HighCo',
          emissionsTco2e: 1000,
          annualSpendEur: 1_000_000,
          methodology: 'average_data',
        }), // 1.0
        s({
          supplierId: 'lo',
          name: 'LowCo',
          emissionsTco2e: 200,
          annualSpendEur: 1_000_000,
          methodology: 'average_data',
        }), // 0.2
      ],
      'FY2025',
    );
    const opp = r.opportunities.find((o) => o.kind === 'reduce_intensity' && o.supplierId === 'hi');
    expect(opp).toBeTruthy();
    // median intensity 0.6 → at-median for HighCo = 600, saving ≈ 400
    expect(opp!.estimatedSavingTco2e).toBeCloseTo(400, 0);
  });

  it('recommends collecting supplier-specific data for spend-based suppliers', () => {
    const r = compareSuppliers(
      [s({ name: 'EstimateCo', methodology: 'spend_based', emissionsTco2e: 250 })],
      'FY2025',
    );
    expect(r.opportunities.some((o) => o.kind === 'refine_data')).toBe(true);
    expect(r.totals.spendBasedShareOfEmissionsPct).toBe(100);
  });

  it('is deterministic', () => {
    const rows = [s({ supplierId: 'a' }), s({ supplierId: 'b', emissionsTco2e: 800 })];
    expect(compareSuppliers(rows, 'FY2025')).toEqual(compareSuppliers(rows, 'FY2025'));
  });
});
