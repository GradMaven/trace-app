import { describe, expect, it } from 'vitest';
import { aggregateEmissions, summariseInventory, type CalculationRow } from './aggregate';

const rows: CalculationRow[] = [
  { scope: 'scope_1', ghgCategory: null, reportingPeriod: 'FY2025', resultValueTco2e: '820.5' },
  { scope: 'scope_1', ghgCategory: null, reportingPeriod: 'FY2025', resultValueTco2e: '482.75' },
  { scope: 'scope_2_location', ghgCategory: null, reportingPeriod: 'FY2025', resultValueTco2e: '4712' },
  { scope: 'scope_2_market', ghgCategory: null, reportingPeriod: 'FY2025', resultValueTco2e: '3100' },
  {
    scope: 'scope_3',
    ghgCategory: 'cat_1_purchased_goods_services',
    reportingPeriod: 'FY2025',
    resultValueTco2e: '2206.76',
  },
  {
    scope: 'scope_3',
    ghgCategory: 'cat_4_upstream_transportation',
    reportingPeriod: 'FY2025',
    resultValueTco2e: '512.4',
  },
  {
    scope: 'scope_3',
    ghgCategory: 'cat_1_purchased_goods_services',
    reportingPeriod: 'FY2024',
    resultValueTco2e: '99',
  },
];

describe('aggregateEmissions', () => {
  it('groups by period, scope and category', () => {
    const totals = aggregateEmissions(rows);
    const s1 = totals.find((t) => t.scope === 'scope_1' && t.reportingPeriod === 'FY2025');
    expect(s1?.valueTco2e).toBe('1303.25');
    expect(s1?.calculationCount).toBe(2);
    const cat1 = totals.find(
      (t) => t.ghgCategory === 'cat_1_purchased_goods_services' && t.reportingPeriod === 'FY2025',
    );
    expect(cat1?.valueTco2e).toBe('2206.76');
  });
});

describe('summariseInventory', () => {
  it('reports scope 2 market-based when present and sums the inventory', () => {
    const s = summariseInventory('FY2025', rows);
    expect(s.scope1).toBe('1303.25');
    expect(s.scope2LocationBased).toBe('4712');
    expect(s.scope2MarketBased).toBe('3100');
    expect(s.scope2Reported).toBe('3100');
    expect(s.scope3).toBe('2719.16');
    // 1303.25 + 3100 + 2719.16
    expect(s.total).toBe('7122.41');
  });

  it('falls back to location-based scope 2 when no market figure exists', () => {
    const noMarket = rows.filter((r) => r.scope !== 'scope_2_market');
    const s = summariseInventory('FY2025', noMarket);
    expect(s.scope2Reported).toBe('4712');
  });

  it('ranks the category breakdown by size (descending)', () => {
    const s = summariseInventory('FY2025', rows);
    expect(s.byCategory[0]!.valueTco2e).toBe('4712'); // scope 2 location
    const values = s.byCategory.map((c) => Number(c.valueTco2e));
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });
});
