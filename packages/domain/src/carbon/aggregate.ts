import Decimal from 'decimal.js';
import { GHG_SCOPE, type GhgScope } from '@trace/shared';

/**
 * Roll calculation results up into GHG-inventory totals (pure). Scope 2 keeps
 * location- and market-based figures separate; the reported total uses
 * market-based where available (brief §4), falling back to location-based.
 */

const AGG_DP = 4;
const ROUNDING = Decimal.ROUND_HALF_UP;

export interface CalculationRow {
  scope: string;
  ghgCategory: string | null;
  reportingPeriod: string;
  resultValueTco2e: string;
}

export interface EmissionTotal {
  scope: string;
  ghgCategory: string | null;
  reportingPeriod: string;
  valueTco2e: string;
  calculationCount: number;
}

export interface InventorySummary {
  reportingPeriod: string;
  scope1: string;
  scope2LocationBased: string;
  scope2MarketBased: string;
  scope2Reported: string;
  scope3: string;
  total: string;
  byCategory: Array<{ scope: string; ghgCategory: string | null; valueTco2e: string; count: number }>;
}

function sum(rows: readonly CalculationRow[]): Decimal {
  return rows.reduce((acc, r) => acc.plus(r.resultValueTco2e), new Decimal(0));
}

function round(d: Decimal): string {
  return d.toDecimalPlaces(AGG_DP, ROUNDING).toFixed();
}

/** Group by (scope, category) into `emission` projection rows. */
export function aggregateEmissions(rows: readonly CalculationRow[]): EmissionTotal[] {
  const groups = new Map<string, CalculationRow[]>();
  for (const r of rows) {
    const key = `${r.reportingPeriod}::${r.scope}::${r.ghgCategory ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.values()].map((list) => ({
    scope: list[0]!.scope,
    ghgCategory: list[0]!.ghgCategory,
    reportingPeriod: list[0]!.reportingPeriod,
    valueTco2e: round(sum(list)),
    calculationCount: list.length,
  }));
}

export function summariseInventory(
  reportingPeriod: string,
  rows: readonly CalculationRow[],
): InventorySummary {
  const forPeriod = rows.filter((r) => r.reportingPeriod === reportingPeriod);
  const byScope = (scope: GhgScope) => forPeriod.filter((r) => r.scope === scope);

  const scope1 = sum(byScope('scope_1'));
  const s2loc = sum(byScope('scope_2_location'));
  const s2mkt = sum(byScope('scope_2_market'));
  const scope3 = sum(byScope('scope_3'));
  const s2reported = s2mkt.gt(0) ? s2mkt : s2loc;
  const total = scope1.plus(s2reported).plus(scope3);

  const byCategory = aggregateEmissions(forPeriod)
    .map((t) => ({
      scope: t.scope,
      ghgCategory: t.ghgCategory,
      valueTco2e: t.valueTco2e,
      count: t.calculationCount,
    }))
    .sort((a, b) => new Decimal(b.valueTco2e).cmp(a.valueTco2e));

  return {
    reportingPeriod,
    scope1: round(scope1),
    scope2LocationBased: round(s2loc),
    scope2MarketBased: round(s2mkt),
    scope2Reported: round(s2reported),
    scope3: round(scope3),
    total: round(total),
    byCategory,
  };
}

export function isGhgScope(value: string): value is GhgScope {
  return (GHG_SCOPE as readonly string[]).includes(value);
}
