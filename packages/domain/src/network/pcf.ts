import { createHash } from 'node:crypto';

/**
 * Product carbon footprints (Phase 14b) — pure, deterministic.
 *
 * Given a product's functional unit, an allocation choice, and a set of
 * bill-of-materials lines each already resolved to "kg CO2e per unit of the
 * line" (the unit-aware factor / supplier-intensity / sub-product-PCF resolution
 * happens in `@trace/db/pcf.ts`, reusing the Phase-4 carbon engine), this rolls
 * up the cradle-to-gate footprint per functional unit, breaks it down by line
 * and by kind, and grades the data quality from the primary-data share. A
 * reproducible `inputsDigest` is stored with every PCF record.
 */

export const PCF_METHOD_VERSION = 'pcf@1.0.0';

export type PcfBoundary = 'cradle_to_gate';
export type PcfLineKind =
  | 'material'
  | 'energy'
  | 'transport'
  | 'component'
  | 'process'
  | 'packaging';
export type PcfLineSource = 'factor' | 'supplier' | 'sub_product' | 'manual';
export type PcfDataTier = 'primary' | 'secondary' | 'estimated';
export type AllocationMethod = 'none' | 'mass' | 'economic' | 'physical';

export const PCF_LINE_KINDS: readonly PcfLineKind[] = [
  'material',
  'energy',
  'transport',
  'component',
  'process',
  'packaging',
];
export const ALLOCATION_METHODS: readonly AllocationMethod[] = [
  'none',
  'mass',
  'economic',
  'physical',
];

export interface PcfLineInput {
  id: string;
  label: string;
  kind: PcfLineKind;
  source: PcfLineSource;
  quantity: number;
  unit: string;
  /** kg CO2e per one `unit` of this line, already unit-resolved. null = unresolved. */
  kgCo2ePerUnit: number | null;
  dataTier: PcfDataTier;
  /** Short human note on how the value was resolved (factor ref, supplier, …). */
  resolvedFrom: string;
  note?: string | null;
}

export interface PcfAllocation {
  method: AllocationMethod;
  /** Share of a (possibly multi-output) process assigned to this product, 0..1. */
  factor: number;
  note?: string | null;
}

export interface ComputeProductFootprintInput {
  functionalUnit: string;
  boundary: PcfBoundary;
  allocation: PcfAllocation;
  lines: PcfLineInput[];
}

export interface PcfBreakdownLine {
  id: string;
  label: string;
  kind: PcfLineKind;
  source: PcfLineSource;
  dataTier: PcfDataTier;
  quantity: number;
  unit: string;
  kgCo2ePerUnit: number | null;
  /** Pre-allocation contribution to one functional unit, kg CO2e. */
  kgCo2e: number;
  sharePct: number;
  resolvedFrom: string;
  warning: string | null;
}

export interface ProductFootprint {
  methodVersion: string;
  boundary: PcfBoundary;
  functionalUnit: string;
  allocation: PcfAllocation;
  /** Σ of resolved lines, kg CO2e per functional unit, before allocation. */
  subtotalKgCo2e: number;
  /** `subtotal × allocation.factor`, kg CO2e per functional unit. */
  totalKgCo2e: number;
  breakdown: PcfBreakdownLine[];
  byKind: Array<{ kind: PcfLineKind; kgCo2e: number; sharePct: number }>;
  primaryDataSharePct: number;
  secondaryDataSharePct: number;
  estimatedDataSharePct: number;
  dataQualityRating: 'A' | 'B' | 'C' | 'D' | 'E';
  unresolvedLines: number;
  warnings: string[];
  inputsDigest: string;
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Map a calculation methodology onto the PCF data tier. */
export function pcfDataTierForMethodology(methodology: string | null | undefined): PcfDataTier {
  switch (methodology) {
    case 'supplier_specific':
    case 'fuel_based':
    case 'energy_based':
      return 'primary';
    case 'spend_based':
      return 'estimated';
    default:
      return 'secondary';
  }
}

export function computeProductFootprint(
  input: ComputeProductFootprintInput,
): ProductFootprint {
  const { method, factor } = input.allocation;
  if (!(factor >= 0 && factor <= 1)) {
    throw new Error(`Allocation factor must be between 0 and 1, got ${factor}.`);
  }

  const warnings: string[] = [];
  if (method === 'none' && factor !== 1) {
    warnings.push('Allocation method is "none" but the factor is not 1.');
  }

  const rawLines = input.lines.map((l) => {
    const resolved = l.kgCo2ePerUnit != null;
    const kg = resolved ? round(l.quantity * (l.kgCo2ePerUnit as number)) : 0;
    const warning = resolved ? null : `Line "${l.label}" has no resolved emission value.`;
    if (warning) warnings.push(warning);
    return { l, kg, resolved, warning };
  });

  const subtotal = round(rawLines.reduce((a, r) => a + r.kg, 0));
  const total = round(subtotal * factor);

  const breakdown: PcfBreakdownLine[] = rawLines.map(({ l, kg, warning }) => ({
    id: l.id,
    label: l.label,
    kind: l.kind,
    source: l.source,
    dataTier: l.dataTier,
    quantity: l.quantity,
    unit: l.unit,
    kgCo2ePerUnit: l.kgCo2ePerUnit,
    kgCo2e: kg,
    sharePct: subtotal > 0 ? round((kg / subtotal) * 100, 2) : 0,
    resolvedFrom: l.resolvedFrom,
    warning,
  }));

  const byKind = PCF_LINE_KINDS.map((kind) => {
    const kg = round(
      breakdown.filter((b) => b.kind === kind).reduce((a, b) => a + b.kgCo2e, 0),
    );
    return { kind, kgCo2e: kg, sharePct: subtotal > 0 ? round((kg / subtotal) * 100, 2) : 0 };
  }).filter((k) => k.kgCo2e !== 0);

  const tierKg = (tier: PcfDataTier): number =>
    round(rawLines.filter((r) => r.l.dataTier === tier).reduce((a, r) => a + r.kg, 0));
  const pct = (x: number): number => (subtotal > 0 ? round((x / subtotal) * 100, 1) : 0);
  const primaryPct = pct(tierKg('primary'));

  const rating: ProductFootprint['dataQualityRating'] =
    primaryPct >= 80
      ? 'A'
      : primaryPct >= 60
        ? 'B'
        : primaryPct >= 40
          ? 'C'
          : primaryPct >= 20
            ? 'D'
            : 'E';

  const inputsDigest = createHash('sha256')
    .update(
      JSON.stringify({
        v: PCF_METHOD_VERSION,
        fu: input.functionalUnit,
        b: input.boundary,
        a: { m: method, f: factor },
        lines: input.lines.map((l) => [
          l.id,
          l.kind,
          l.source,
          l.quantity,
          l.unit,
          l.kgCo2ePerUnit,
          l.dataTier,
        ]),
      }),
    )
    .digest('hex');

  return {
    methodVersion: PCF_METHOD_VERSION,
    boundary: input.boundary,
    functionalUnit: input.functionalUnit,
    allocation: input.allocation,
    subtotalKgCo2e: subtotal,
    totalKgCo2e: total,
    breakdown,
    byKind,
    primaryDataSharePct: primaryPct,
    secondaryDataSharePct: pct(tierKg('secondary')),
    estimatedDataSharePct: pct(tierKg('estimated')),
    dataQualityRating: rating,
    unresolvedLines: rawLines.filter((r) => !r.resolved).length,
    warnings: [...new Set(warnings)],
    inputsDigest,
  };
}
