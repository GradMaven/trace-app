import { describe, expect, it } from 'vitest';
import { co2eToTonnes, convert, isKnownUnit, unitDimension, UnitError } from './units';

describe('convert', () => {
  it('converts within mass', () => {
    expect(convert(1, 't', 'kg').toString()).toBe('1000');
    expect(convert(1283, 't', 'kg').toString()).toBe('1283000');
    expect(convert(1000, 'kg', 't').toString()).toBe('1');
  });

  it('converts within energy', () => {
    expect(convert(1, 'MWh', 'kWh').toString()).toBe('1000');
    expect(convert(1, 'GJ', 'kWh').toDecimalPlaces(6).toString()).toBe('277.777778');
  });

  it('resolves aliases', () => {
    expect(convert(2, 'tonne', 'kg').toString()).toBe('2000');
    expect(convert(1, 'litre', 'mL').toString()).toBe('1000');
    expect(unitDimension('tkm')).toBe('freight');
  });

  it('throws across dimensions', () => {
    expect(() => convert(1, 'kg', 'kWh')).toThrow(UnitError);
    expect(() => convert(1, 'km', 't.km')).toThrow(/different dimensions/);
  });

  it('refuses currency cross-conversion but allows identity', () => {
    expect(convert(100, 'EUR', 'EUR').toString()).toBe('100');
    expect(() => convert(100, 'EUR', 'USD')).toThrow(/currency conversion/i);
  });

  it('rejects unknown units', () => {
    expect(() => convert(1, 'furlong', 'km')).toThrow(/Unknown unit/);
    expect(isKnownUnit('furlong')).toBe(false);
    expect(isKnownUnit('kWh')).toBe(true);
  });
});

describe('co2eToTonnes', () => {
  it('scales each CO2e unit to tonnes', () => {
    expect(co2eToTonnes(2500, 'kgCO2e').toString()).toBe('2.5');
    expect(co2eToTonnes(500000, 'gCO2e').toString()).toBe('0.5');
    expect(co2eToTonnes(3, 'tCO2e').toString()).toBe('3');
    expect(co2eToTonnes(1, 'ktCO2e').toString()).toBe('1000');
  });
});
