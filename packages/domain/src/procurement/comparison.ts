import type { Provenance } from '@trace/shared';

/**
 * Supplier carbon comparison (brief Module F / Phase 11). Pure, deterministic.
 * Given each supplier's attributed Scope 3 emissions, annual spend, data
 * provenance and Trust, it derives carbon intensity, shares and a ranking, and
 * proposes deterministic reduction opportunities. No AI — the AI Recommendation
 * capability is a later phase.
 */

export const PROCUREMENT_ENGINE_VERSION = 'procurement@1';

const OPPORTUNITY_CAP = 6;

export interface SupplierComparisonInput {
  supplierId: string;
  name: string;
  country: string | null;
  category: string | null;
  tier: number | null;
  annualSpendEur: number | null;
  /** Sum of the supplier's attributed emission datapoints for the period, tCO2e. */
  emissionsTco2e: number | null;
  /** Best provenance among those datapoints. */
  provenance: Provenance | null;
  /** Methodology of the backing calculation(s): `supplier_specific` | `spend_based` | … */
  methodology: string | null;
  /** Lowest Trust Score among the supplier's emission datapoints, or null. */
  trustScore: number | null;
  hasPassport: boolean;
}

export type AttributionQuality = 'supplier_specific' | 'spend_based' | 'other' | 'none';

export interface SupplierComparisonRow extends SupplierComparisonInput {
  /** tCO2e per €1,000 of annual spend. null when spend or emissions unknown. */
  carbonIntensityPerKEur: number | null;
  emissionsSharePct: number | null;
  spendSharePct: number | null;
  /** 1 = highest carbon intensity in the compared set. */
  intensityRank: number | null;
  attributionQuality: AttributionQuality;
  flags: string[];
}

export interface ReductionOpportunity {
  kind: 'refine_data' | 'reduce_intensity' | 'engage_supplier' | 'reduce_volume';
  supplierId: string;
  supplierName: string;
  title: string;
  detail: string;
  /** Indicative tCO2e avoidable, on a stated basis. null when not quantifiable. */
  estimatedSavingTco2e: number | null;
}

export interface SupplierComparison {
  engineVersion: string;
  reportingPeriod: string | null;
  rows: SupplierComparisonRow[];
  totals: {
    suppliers: number;
    withEmissions: number;
    totalEmissionsTco2e: number;
    totalSpendEur: number;
    medianIntensityPerKEur: number | null;
    spendBasedShareOfEmissionsPct: number;
  };
  opportunities: ReductionOpportunity[];
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

function attributionQuality(input: SupplierComparisonInput): AttributionQuality {
  if (input.emissionsTco2e == null) return 'none';
  if (input.methodology === 'supplier_specific') return 'supplier_specific';
  if (input.methodology === 'spend_based') return 'spend_based';
  return 'other';
}

export function compareSuppliers(
  inputs: readonly SupplierComparisonInput[],
  reportingPeriod: string | null,
): SupplierComparison {
  const totalEmissions = inputs.reduce((a, s) => a + (s.emissionsTco2e ?? 0), 0);
  const totalSpend = inputs.reduce((a, s) => a + (s.annualSpendEur ?? 0), 0);
  const spendBasedEmissions = inputs
    .filter((s) => s.methodology === 'spend_based')
    .reduce((a, s) => a + (s.emissionsTco2e ?? 0), 0);

  const withIntensity = inputs
    .map((s) => ({
      s,
      intensity:
        s.emissionsTco2e != null && s.annualSpendEur != null && s.annualSpendEur > 0
          ? s.emissionsTco2e / (s.annualSpendEur / 1000)
          : null,
    }))
    .filter((x): x is { s: SupplierComparisonInput; intensity: number } => x.intensity != null)
    .sort((a, b) => b.intensity - a.intensity);

  const rankById = new Map<string, number>();
  withIntensity.forEach((x, i) => rankById.set(x.s.supplierId, i + 1));
  const medianIntensity = median(withIntensity.map((x) => x.intensity));

  const rows: SupplierComparisonRow[] = inputs
    .map((s) => {
      const intensity =
        s.emissionsTco2e != null && s.annualSpendEur != null && s.annualSpendEur > 0
          ? round(s.emissionsTco2e / (s.annualSpendEur / 1000), 4)
          : null;
      const quality = attributionQuality(s);
      const flags: string[] = [];
      if (quality === 'spend_based') flags.push('spend-based estimate');
      if (quality === 'none') flags.push('no attributed emissions');
      if (!s.hasPassport) flags.push('no supplier passport');
      if (s.trustScore != null && s.trustScore < 50) flags.push('low Trust Score');
      return {
        ...s,
        carbonIntensityPerKEur: intensity,
        emissionsSharePct:
          totalEmissions > 0 && s.emissionsTco2e != null
            ? round((s.emissionsTco2e / totalEmissions) * 100, 2)
            : null,
        spendSharePct:
          totalSpend > 0 && s.annualSpendEur != null
            ? round((s.annualSpendEur / totalSpend) * 100, 2)
            : null,
        intensityRank: rankById.get(s.supplierId) ?? null,
        attributionQuality: quality,
        flags,
      };
    })
    .sort((a, b) => {
      if (a.carbonIntensityPerKEur == null && b.carbonIntensityPerKEur == null) return 0;
      if (a.carbonIntensityPerKEur == null) return 1;
      if (b.carbonIntensityPerKEur == null) return -1;
      return b.carbonIntensityPerKEur - a.carbonIntensityPerKEur;
    });

  const opportunities: ReductionOpportunity[] = [];
  for (const r of rows) {
    if (r.emissionsTco2e == null) continue;

    // Bring an above-median-intensity supplier down to the set median.
    if (
      medianIntensity != null &&
      r.carbonIntensityPerKEur != null &&
      r.carbonIntensityPerKEur > medianIntensity &&
      r.annualSpendEur != null
    ) {
      const atMedian = (r.annualSpendEur / 1000) * medianIntensity;
      const saving = r.emissionsTco2e - atMedian;
      if (saving > 0.5) {
        opportunities.push({
          kind: 'reduce_intensity',
          supplierId: r.supplierId,
          supplierName: r.name,
          title: `Bring ${r.name} to the peer-median carbon intensity`,
          detail: `${r.name} is ${round(r.carbonIntensityPerKEur, 2)} tCO2e/€1k vs a set median of ${round(
            medianIntensity,
            2,
          )}. Matching the median (via supplier engagement, material substitution or contract terms) would avoid roughly ${round(saving, 1)} tCO2e.`,
          estimatedSavingTco2e: round(saving, 1),
        });
      }
    }

    // Replace a spend-based estimate with supplier-specific data.
    if (r.attributionQuality === 'spend_based' && r.emissionsTco2e > 1) {
      opportunities.push({
        kind: 'refine_data',
        supplierId: r.supplierId,
        supplierName: r.name,
        title: `Collect supplier-specific data from ${r.name}`,
        detail: `${r.name}'s ${round(r.emissionsTco2e, 1)} tCO2e is a spend-based EEIO estimate — the lowest primary-data tier. A supplier-specific product carbon footprint replaces the estimate and usually lowers it.`,
        estimatedSavingTco2e: null,
      });
    }

    // Onboard a material tier-1 supplier with no passport.
    if (!r.hasPassport && (r.tier ?? 9) <= 1 && r.emissionsTco2e > 1) {
      opportunities.push({
        kind: 'engage_supplier',
        supplierId: r.supplierId,
        supplierName: r.name,
        title: `Onboard ${r.name} to the supplier portal`,
        detail: `${r.name} is a tier-1 supplier (${round(r.emissionsTco2e, 1)} tCO2e attributed) with no Supplier Passport. Invite them to submit primary data.`,
        estimatedSavingTco2e: null,
      });
    }
  }

  opportunities.sort((a, b) => (b.estimatedSavingTco2e ?? -1) - (a.estimatedSavingTco2e ?? -1));

  return {
    engineVersion: PROCUREMENT_ENGINE_VERSION,
    reportingPeriod,
    rows,
    totals: {
      suppliers: inputs.length,
      withEmissions: inputs.filter((s) => s.emissionsTco2e != null).length,
      totalEmissionsTco2e: round(totalEmissions, 4),
      totalSpendEur: round(totalSpend, 2),
      medianIntensityPerKEur: medianIntensity != null ? round(medianIntensity, 4) : null,
      spendBasedShareOfEmissionsPct:
        totalEmissions > 0 ? round((spendBasedEmissions / totalEmissions) * 100, 1) : 0,
    },
    opportunities: opportunities.slice(0, OPPORTUNITY_CAP),
  };
}
