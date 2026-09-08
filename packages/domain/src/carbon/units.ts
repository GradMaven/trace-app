import Decimal from 'decimal.js';

/**
 * Unit registry + conversion (brief §5, docs/domain-model.md).
 *
 * The registry is the single source of truth for conversion math. Each unit
 * belongs to a `Dimension` and carries an exact factor to that dimension's base
 * unit. Conversions across dimensions throw; currency has no cross-rate
 * (spend-based factors must be applied in their own currency).
 *
 * All arithmetic uses decimal.js so results are exact and reproducible
 * (Principle 8).
 */

export type Dimension =
  | 'mass'
  | 'energy'
  | 'volume'
  | 'distance'
  | 'freight' // mass × distance, e.g. tonne-kilometres
  | 'passenger_distance'
  | 'count'
  | 'area'
  | 'currency';

export interface UnitDef {
  code: string;
  dimension: Dimension;
  /** Exact multiplier to the dimension's base unit, as a decimal string. */
  toBase: string;
  aliases?: string[];
  label?: string;
}

const BASE_UNIT: Record<Dimension, string> = {
  mass: 'kg',
  energy: 'kWh',
  volume: 'L',
  distance: 'km',
  freight: 't.km',
  passenger_distance: 'p.km',
  count: 'unit',
  area: 'm2',
  currency: 'EUR',
};

const RAW_UNITS: UnitDef[] = [
  // mass (base kg)
  { code: 'kg', dimension: 'mass', toBase: '1', label: 'kilogram' },
  { code: 'g', dimension: 'mass', toBase: '0.001', label: 'gram' },
  { code: 't', dimension: 'mass', toBase: '1000', aliases: ['tonne', 'mt', 'MT'], label: 'metric tonne' },
  { code: 'kt', dimension: 'mass', toBase: '1000000', label: 'kilotonne' },
  { code: 'lb', dimension: 'mass', toBase: '0.45359237', label: 'pound' },

  // energy (base kWh)
  { code: 'kWh', dimension: 'energy', toBase: '1', label: 'kilowatt-hour' },
  { code: 'MWh', dimension: 'energy', toBase: '1000', label: 'megawatt-hour' },
  { code: 'GWh', dimension: 'energy', toBase: '1000000', label: 'gigawatt-hour' },
  { code: 'Wh', dimension: 'energy', toBase: '0.001', label: 'watt-hour' },
  { code: 'MJ', dimension: 'energy', toBase: '0.27777777777778', label: 'megajoule' },
  { code: 'GJ', dimension: 'energy', toBase: '277.77777777778', label: 'gigajoule' },
  { code: 'kWh_th', dimension: 'energy', toBase: '1', aliases: ['kWh(th)'], label: 'kilowatt-hour (thermal)' },
  { code: 'therm', dimension: 'energy', toBase: '29.307107017', label: 'therm' },
  { code: 'MMBtu', dimension: 'energy', toBase: '293.07107017', label: 'million British thermal units' },

  // volume (base L)
  { code: 'L', dimension: 'volume', toBase: '1', aliases: ['l', 'litre', 'liter'], label: 'litre' },
  { code: 'mL', dimension: 'volume', toBase: '0.001', label: 'millilitre' },
  { code: 'm3', dimension: 'volume', toBase: '1000', aliases: ['m³', 'Nm3'], label: 'cubic metre' },
  { code: 'gal_us', dimension: 'volume', toBase: '3.785411784', label: 'US gallon' },

  // distance (base km)
  { code: 'km', dimension: 'distance', toBase: '1', label: 'kilometre' },
  { code: 'm', dimension: 'distance', toBase: '0.001', label: 'metre' },
  { code: 'mi', dimension: 'distance', toBase: '1.609344', aliases: ['mile'], label: 'mile' },

  // freight (base tonne-kilometre)
  { code: 't.km', dimension: 'freight', toBase: '1', aliases: ['tkm', 'tonne.km', 't·km'], label: 'tonne-kilometre' },
  { code: 'kg.km', dimension: 'freight', toBase: '0.001', aliases: ['kgkm'], label: 'kilogram-kilometre' },
  { code: 't.mi', dimension: 'freight', toBase: '1.609344', label: 'tonne-mile' },

  // passenger distance (base passenger-kilometre)
  {
    code: 'p.km',
    dimension: 'passenger_distance',
    toBase: '1',
    aliases: ['pkm', 'passenger.km', 'pax.km'],
    label: 'passenger-kilometre',
  },
  { code: 'p.mi', dimension: 'passenger_distance', toBase: '1.609344', label: 'passenger-mile' },

  // count (base unit)
  { code: 'unit', dimension: 'count', toBase: '1', aliases: ['item', 'each', 'pcs', 'ea'], label: 'unit' },
  { code: 'fte', dimension: 'count', toBase: '1', aliases: ['FTE'], label: 'full-time equivalent' },
  { code: 'night', dimension: 'count', toBase: '1', aliases: ['room-night'], label: 'night' },

  // area (base m2)
  { code: 'm2', dimension: 'area', toBase: '1', aliases: ['m²', 'sqm'], label: 'square metre' },
  { code: 'ha', dimension: 'area', toBase: '10000', label: 'hectare' },

  // currency (no cross-rate)
  { code: 'EUR', dimension: 'currency', toBase: '1', label: 'euro' },
  { code: 'USD', dimension: 'currency', toBase: '1', label: 'US dollar' },
  { code: 'GBP', dimension: 'currency', toBase: '1', label: 'pound sterling' },
];

const REGISTRY = new Map<string, UnitDef>();
for (const def of RAW_UNITS) {
  REGISTRY.set(def.code.toLowerCase(), def);
  for (const alias of def.aliases ?? []) REGISTRY.set(alias.toLowerCase(), def);
}

export class UnitError extends Error {
  readonly code = 'unit.error';
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

export function resolveUnit(code: string): UnitDef {
  const def = REGISTRY.get(code.trim().toLowerCase());
  if (!def) throw new UnitError(`Unknown unit: "${code}".`);
  return def;
}

export function isKnownUnit(code: string): boolean {
  return REGISTRY.has(code.trim().toLowerCase());
}

export function unitDimension(code: string): Dimension {
  return resolveUnit(code).dimension;
}

export function baseUnitFor(dimension: Dimension): string {
  return BASE_UNIT[dimension];
}

/** Convert `value` from one unit to another within the same dimension. */
export function convert(value: Decimal.Value, from: string, to: string): Decimal {
  const f = resolveUnit(from);
  const t = resolveUnit(to);
  if (f.dimension !== t.dimension) {
    throw new UnitError(
      `Cannot convert ${from} (${f.dimension}) to ${to} (${t.dimension}) — different dimensions.`,
    );
  }
  if (f.dimension === 'currency' && f.code !== t.code) {
    throw new UnitError(
      `No currency conversion: ${from} → ${to}. Apply the factor in its own currency.`,
    );
  }
  return new Decimal(value).mul(f.toBase).div(t.toBase);
}

export function listUnits(): UnitDef[] {
  return [...RAW_UNITS];
}

/** All CO2e emission-amount units, with their factor to tonnes CO2e. */
export const CO2E_UNITS: Record<string, string> = {
  gCO2e: '0.000001',
  kgCO2e: '0.001',
  tCO2e: '1',
  ktCO2e: '1000',
};
export type Co2eUnit = keyof typeof CO2E_UNITS;

export function co2eToTonnes(value: Decimal.Value, unit: string): Decimal {
  const factor = CO2E_UNITS[unit];
  if (!factor) throw new UnitError(`Unknown CO2e unit: "${unit}".`);
  return new Decimal(value).mul(factor);
}

export function isCo2eUnit(unit: string): unit is Co2eUnit {
  return unit in CO2E_UNITS;
}
