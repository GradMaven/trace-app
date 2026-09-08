import { describe, expect, it } from 'vitest';
import { CALC_ENGINE_VERSION, computeEmission, recompute } from './engine';
import { UnitError } from './units';

describe('computeEmission', () => {
  it('reproduces the brief example: 1,283 t steel × 1.72 tCO2e/t = 2,206.76 tCO2e', () => {
    const r = computeEmission({
      activityValue: 1283,
      activityUnit: 't',
      factorValue: '1.72',
      factorNumeratorUnit: 'tCO2e',
      factorDenominatorUnit: 't',
      gwpSet: 'AR6',
      methodology: 'supplier_specific',
    });
    expect(r.resultValueTco2e).toBe('2206.76');
    expect(r.calculationVersion).toBe(CALC_ENGINE_VERSION);
    expect(r.normalizedValue).toBe('1283');
    expect(r.steps.at(-1)).toContain('2206.76 tCO2e');
  });

  it('is unit-agnostic: same result from kg activity against a per-tonne factor', () => {
    const r = computeEmission({
      activityValue: 1_283_000,
      activityUnit: 'kg',
      factorValue: '1.72',
      factorNumeratorUnit: 'tCO2e',
      factorDenominatorUnit: 't',
      gwpSet: 'AR6',
      methodology: 'supplier_specific',
    });
    expect(r.resultValueTco2e).toBe('2206.76');
    expect(r.normalizedValue).toBe('1283');
  });

  it('handles kgCO2e factors (electricity)', () => {
    const r = computeEmission({
      activityValue: 12_400_000,
      activityUnit: 'kWh',
      factorValue: '0.380',
      factorNumeratorUnit: 'kgCO2e',
      factorDenominatorUnit: 'kWh',
      gwpSet: 'AR6',
      methodology: 'average_data',
    });
    expect(r.emissionsInNumerator).toBe('4712000');
    expect(r.resultValueTco2e).toBe('4712');
  });

  it('handles gCO2e factors', () => {
    const r = computeEmission({
      activityValue: 1000,
      activityUnit: 'kWh',
      factorValue: '500',
      factorNumeratorUnit: 'gCO2e',
      factorDenominatorUnit: 'kWh',
      gwpSet: 'AR5',
      methodology: 'average_data',
    });
    expect(r.resultValueTco2e).toBe('0.5');
  });

  it('handles spend-based factors in EUR', () => {
    const r = computeEmission({
      activityValue: '250000',
      activityUnit: 'EUR',
      factorValue: '0.28',
      factorNumeratorUnit: 'kgCO2e',
      factorDenominatorUnit: 'EUR',
      gwpSet: 'AR6',
      methodology: 'spend_based',
    });
    expect(r.resultValueTco2e).toBe('70'); // 250000 * 0.28 = 70000 kg = 70 t
  });

  it('rejects an activity unit incompatible with the factor denominator', () => {
    expect(() =>
      computeEmission({
        activityValue: 100,
        activityUnit: 'kWh',
        factorValue: '1',
        factorNumeratorUnit: 'kgCO2e',
        factorDenominatorUnit: 'kg',
        gwpSet: 'AR6',
        methodology: 'average_data',
      }),
    ).toThrow(UnitError);
  });

  it('rejects a non-CO2e numerator unit', () => {
    expect(() =>
      computeEmission({
        activityValue: 1,
        activityUnit: 't',
        factorValue: '1',
        factorNumeratorUnit: 'kg',
        factorDenominatorUnit: 't',
        gwpSet: 'AR6',
        methodology: 'average_data',
      }),
    ).toThrow(/CO2e unit/);
  });
});

describe('recompute', () => {
  it('reproduces a stored result bit-for-bit', () => {
    const input = {
      activityValue: '1283',
      activityUnit: 't',
      factorValue: '1.72',
      factorNumeratorUnit: 'tCO2e',
      factorDenominatorUnit: 't',
      gwpSet: 'AR6',
      methodology: 'supplier_specific',
    };
    const first = computeEmission(input);
    const { reproduced, result } = recompute({ ...input, resultValueTco2e: first.resultValueTco2e });
    expect(reproduced).toBe(true);
    expect(result.resultValueTco2e).toBe(first.resultValueTco2e);
    expect(result.steps).toEqual(first.steps);
  });

  it('flags a mismatch when the stored result was tampered with', () => {
    const input = {
      activityValue: '1283',
      activityUnit: 't',
      factorValue: '1.72',
      factorNumeratorUnit: 'tCO2e' as const,
      factorDenominatorUnit: 't',
      gwpSet: 'AR6',
      methodology: 'supplier_specific',
    };
    expect(recompute({ ...input, resultValueTco2e: '9999' }).reproduced).toBe(false);
  });
});
