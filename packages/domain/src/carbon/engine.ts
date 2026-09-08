import Decimal from 'decimal.js';
import { co2eToTonnes, convert, isCo2eUnit, resolveUnit, UnitError } from './units';

/**
 * Deterministic emissions calculation engine (brief §5).
 *
 *   activity_quantity (normalised to the factor's denominator unit)
 *     × emission_factor
 *     → emissions, normalised to tCO2e
 *
 * The engine stores every intermediate value and a human-readable `steps` trail,
 * so any result is reproducible from its inputs alone: feeding a stored
 * calculation's echoed inputs back through `computeEmission` yields the identical
 * `resultValueTco2e` string (Principle 8). Result is rounded to 6 decimal places
 * (matching `numeric(20,6)` storage) with a fixed rounding mode.
 */

export const CALC_ENGINE_VERSION = 'calc-engine@1';

const RESULT_DP = 6;
const ROUNDING = Decimal.ROUND_HALF_UP;

export interface ComputeEmissionInput {
  activityValue: Decimal.Value;
  activityUnit: string;
  factorValue: Decimal.Value;
  /** Emission amount unit of the factor's numerator: gCO2e | kgCO2e | tCO2e | ktCO2e. */
  factorNumeratorUnit: string;
  /** Activity unit the factor is expressed per, e.g. 'kg', 'kWh', 't.km', 'EUR'. */
  factorDenominatorUnit: string;
  /** GWP characterisation set, e.g. 'AR6'. Passed through; not used in arithmetic. */
  gwpSet: string;
  methodology: string;
  assumptions?: Record<string, unknown>;
}

export interface CalculationResult {
  calculationVersion: string;
  inputValue: string;
  inputUnit: string;
  normalizedValue: string;
  normalizedUnit: string;
  factorValue: string;
  factorNumeratorUnit: string;
  factorDenominatorUnit: string;
  gwpSet: string;
  methodology: string;
  emissionsInNumerator: string;
  resultValueTco2e: string;
  steps: string[];
  assumptions: Record<string, unknown>;
}

function fmt(d: Decimal): string {
  // Stable, non-exponential, no trailing zeros.
  let s = d.toDecimalPlaces(12, ROUNDING).toFixed();
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function computeEmission(input: ComputeEmissionInput): CalculationResult {
  if (!isCo2eUnit(input.factorNumeratorUnit)) {
    throw new UnitError(`Factor numerator must be a CO2e unit, got "${input.factorNumeratorUnit}".`);
  }

  const activity = new Decimal(input.activityValue);
  const factor = new Decimal(input.factorValue);
  const denom = resolveUnit(input.factorDenominatorUnit);
  const activityUnit = resolveUnit(input.activityUnit);

  if (activityUnit.dimension !== denom.dimension) {
    throw new UnitError(
      `Activity unit "${input.activityUnit}" (${activityUnit.dimension}) is not compatible with ` +
        `factor denominator "${input.factorDenominatorUnit}" (${denom.dimension}).`,
    );
  }

  const normalized = convert(activity, input.activityUnit, input.factorDenominatorUnit);
  const emissionsInNumerator = normalized.mul(factor);
  const resultTonnes = co2eToTonnes(emissionsInNumerator, input.factorNumeratorUnit).toDecimalPlaces(
    RESULT_DP,
    ROUNDING,
  );

  const steps: string[] = [];
  if (!normalized.eq(activity) || input.activityUnit !== input.factorDenominatorUnit) {
    steps.push(
      `Normalise activity: ${fmt(activity)} ${input.activityUnit} → ${fmt(normalized)} ${input.factorDenominatorUnit}`,
    );
  } else {
    steps.push(`Activity: ${fmt(activity)} ${input.factorDenominatorUnit}`);
  }
  steps.push(
    `Apply factor: ${fmt(normalized)} ${input.factorDenominatorUnit} × ${fmt(factor)} ` +
      `${input.factorNumeratorUnit}/${input.factorDenominatorUnit} = ${fmt(emissionsInNumerator)} ${input.factorNumeratorUnit}`,
  );
  if (input.factorNumeratorUnit !== 'tCO2e') {
    steps.push(
      `Convert to tonnes: ${fmt(emissionsInNumerator)} ${input.factorNumeratorUnit} → ${resultTonnes.toFixed()} tCO2e`,
    );
  }
  steps.push(`Result: ${resultTonnes.toFixed()} tCO2e (${input.gwpSet}, method: ${input.methodology})`);

  return {
    calculationVersion: CALC_ENGINE_VERSION,
    inputValue: fmt(activity),
    inputUnit: input.activityUnit,
    normalizedValue: fmt(normalized),
    normalizedUnit: input.factorDenominatorUnit,
    factorValue: fmt(factor),
    factorNumeratorUnit: input.factorNumeratorUnit,
    factorDenominatorUnit: input.factorDenominatorUnit,
    gwpSet: input.gwpSet,
    methodology: input.methodology,
    emissionsInNumerator: fmt(emissionsInNumerator),
    resultValueTco2e: resultTonnes.toFixed(),
    steps,
    assumptions: input.assumptions ?? {},
  };
}

/**
 * Re-run a stored calculation from its persisted inputs and confirm the result
 * is bit-for-bit identical. Used by the "reproduce" action and by tests.
 */
export function recompute(stored: ComputeEmissionInput & { resultValueTco2e: string }): {
  reproduced: boolean;
  result: CalculationResult;
} {
  const result = computeEmission(stored);
  return { reproduced: result.resultValueTco2e === stored.resultValueTco2e, result };
}
