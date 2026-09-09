import Decimal from 'decimal.js';
import { computeEmission } from '../carbon/engine';
import { PROCUREMENT_ENGINE_VERSION } from './comparison';

/**
 * Procurement what-if scenario engine (Phase 11). Pure, deterministic — it
 * re-runs the carbon `computeEmission` engine on a set of supplier lines with a
 * set of proposed changes (cut volume, switch to a cleaner factor, drop a
 * supplier) and reports the baseline → projected delta. It never mutates stored
 * calculations; a scenario is a hypothetical the caller may save.
 */

const AGG_DP = 4;
const ROUNDING = Decimal.ROUND_HALF_UP;

export interface ScenarioLineInput {
  supplierId: string;
  supplierName: string;
  label: string;
  activityValue: number;
  activityUnit: string;
  factorValue: number;
  /** gCO2e | kgCO2e | tCO2e | ktCO2e */
  factorNumeratorUnit: string;
  /** Activity unit the factor is per (e.g. 't', 'kWh', 't.km', 'EUR'). */
  factorDenominatorUnit: string;
  gwpSet: string;
  methodology: string;
}

export interface ScenarioChange {
  supplierId: string;
  /** Multiply the activity quantity by this (0.8 = cut 20%). Default 1. */
  activityMultiplier?: number;
  /** Replace the emission-factor value (same units). */
  factorValue?: number;
  /** Replace the methodology label (documentation only; not used in arithmetic). */
  methodology?: string;
  /** Remove the line entirely. */
  drop?: boolean;
}

export interface ScenarioLineResult {
  supplierId: string;
  supplierName: string;
  label: string;
  baselineTco2e: string;
  projectedTco2e: string;
  deltaTco2e: string;
  changed: boolean;
  note: string;
}

export interface ScenarioResult {
  engineVersion: string;
  baselineTco2e: string;
  projectedTco2e: string;
  deltaTco2e: string;
  deltaPct: string;
  lines: ScenarioLineResult[];
}

function round(d: Decimal): string {
  return d.toDecimalPlaces(AGG_DP, ROUNDING).toFixed();
}

export function projectScenario(
  lines: readonly ScenarioLineInput[],
  changes: readonly ScenarioChange[],
): ScenarioResult {
  const changeBySupplier = new Map(changes.map((c) => [c.supplierId, c]));

  let baseline = new Decimal(0);
  let projected = new Decimal(0);
  const lineResults: ScenarioLineResult[] = [];

  for (const line of lines) {
    const base = new Decimal(
      computeEmission({
        activityValue: line.activityValue,
        activityUnit: line.activityUnit,
        factorValue: line.factorValue,
        factorNumeratorUnit: line.factorNumeratorUnit,
        factorDenominatorUnit: line.factorDenominatorUnit,
        gwpSet: line.gwpSet,
        methodology: line.methodology,
      }).resultValueTco2e,
    );
    baseline = baseline.plus(base);

    const change = changeBySupplier.get(line.supplierId);
    let proj = base;
    let note = 'unchanged';
    let changed = false;

    if (change?.drop) {
      proj = new Decimal(0);
      note = 'line removed';
      changed = true;
    } else if (change) {
      const mult = change.activityMultiplier ?? 1;
      const factorValue = change.factorValue ?? line.factorValue;
      changed = mult !== 1 || factorValue !== line.factorValue || change.methodology != null;
      if (changed) {
        proj = new Decimal(
          computeEmission({
            activityValue: new Decimal(line.activityValue).mul(mult).toNumber(),
            activityUnit: line.activityUnit,
            factorValue,
            factorNumeratorUnit: line.factorNumeratorUnit,
            factorDenominatorUnit: line.factorDenominatorUnit,
            gwpSet: line.gwpSet,
            methodology: change.methodology ?? line.methodology,
          }).resultValueTco2e,
        );
        const parts: string[] = [];
        if (mult !== 1) parts.push(`activity ×${mult}`);
        if (factorValue !== line.factorValue)
          parts.push(`factor ${line.factorValue} → ${factorValue}`);
        if (change.methodology != null) parts.push(`methodology → ${change.methodology}`);
        note = parts.join(', ');
      }
    }

    projected = projected.plus(proj);
    lineResults.push({
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      label: line.label,
      baselineTco2e: round(base),
      projectedTco2e: round(proj),
      deltaTco2e: round(proj.minus(base)),
      changed,
      note,
    });
  }

  const delta = projected.minus(baseline);
  const deltaPct = baseline.isZero()
    ? new Decimal(0)
    : delta.div(baseline).mul(100).toDecimalPlaces(2, ROUNDING);

  return {
    engineVersion: PROCUREMENT_ENGINE_VERSION,
    baselineTco2e: round(baseline),
    projectedTco2e: round(projected),
    deltaTco2e: round(delta),
    deltaPct: deltaPct.toFixed(),
    lines: lineResults,
  };
}
