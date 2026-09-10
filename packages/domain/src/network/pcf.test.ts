import { describe, expect, it } from 'vitest';
import {
  computeProductFootprint,
  PCF_METHOD_VERSION,
  pcfDataTierForMethodology,
  type PcfLineInput,
} from './pcf';

function line(over: Partial<PcfLineInput> = {}): PcfLineInput {
  return {
    id: over.id ?? 'l1',
    label: over.label ?? 'Line',
    kind: over.kind ?? 'material',
    source: over.source ?? 'factor',
    quantity: over.quantity ?? 1,
    unit: over.unit ?? 'kg',
    kgCo2ePerUnit: over.kgCo2ePerUnit === undefined ? 2 : over.kgCo2ePerUnit,
    dataTier: over.dataTier ?? 'secondary',
    resolvedFrom: over.resolvedFrom ?? 'test',
    note: over.note,
  };
}

const base = {
  functionalUnit: '1 t rolled steel',
  boundary: 'cradle_to_gate' as const,
  allocation: { method: 'none' as const, factor: 1 },
};

describe('computeProductFootprint', () => {
  it('rolls up lines and breaks down by line and by kind', () => {
    const f = computeProductFootprint({
      ...base,
      lines: [
        line({ id: 'steel', kind: 'material', quantity: 1000, unit: 'kg', kgCo2ePerUnit: 1.9, dataTier: 'primary' }),
        line({ id: 'power', kind: 'energy', quantity: 400, unit: 'kWh', kgCo2ePerUnit: 0.35, dataTier: 'secondary' }),
        line({ id: 'truck', kind: 'transport', quantity: 300, unit: 't.km', kgCo2ePerUnit: 0.1, dataTier: 'secondary' }),
      ],
    });
    expect(f.methodVersion).toBe(PCF_METHOD_VERSION);
    expect(f.subtotalKgCo2e).toBe(1900 + 140 + 30);
    expect(f.totalKgCo2e).toBe(2070);
    expect(f.breakdown.find((b) => b.id === 'steel')!.kgCo2e).toBe(1900);
    expect(f.breakdown.reduce((a, b) => a + b.sharePct, 0)).toBeCloseTo(100, 0);
    expect(f.byKind.map((k) => k.kind)).toEqual(['material', 'energy', 'transport']);
  });

  it('applies the allocation factor and warns on a mismatch', () => {
    const f = computeProductFootprint({
      ...base,
      allocation: { method: 'mass', factor: 0.4 },
      lines: [line({ quantity: 100, kgCo2ePerUnit: 1 })],
    });
    expect(f.subtotalKgCo2e).toBe(100);
    expect(f.totalKgCo2e).toBe(40);

    const w = computeProductFootprint({
      ...base,
      allocation: { method: 'none', factor: 0.5 },
      lines: [line()],
    });
    expect(w.warnings.some((x) => /method is "none"/.test(x))).toBe(true);
  });

  it('rejects an out-of-range allocation factor', () => {
    expect(() =>
      computeProductFootprint({ ...base, allocation: { method: 'none', factor: 1.5 }, lines: [line()] }),
    ).toThrow(/between 0 and 1/);
  });

  it('grades data quality from the primary-data share', () => {
    const mostlyPrimary = computeProductFootprint({
      ...base,
      lines: [
        line({ id: 'a', quantity: 90, kgCo2ePerUnit: 1, dataTier: 'primary' }),
        line({ id: 'b', quantity: 10, kgCo2ePerUnit: 1, dataTier: 'secondary' }),
      ],
    });
    expect(mostlyPrimary.primaryDataSharePct).toBe(90);
    expect(mostlyPrimary.dataQualityRating).toBe('A');

    const mixed = computeProductFootprint({
      ...base,
      lines: [
        line({ id: 'a', quantity: 30, kgCo2ePerUnit: 1, dataTier: 'primary' }),
        line({ id: 'b', quantity: 70, kgCo2ePerUnit: 1, dataTier: 'estimated' }),
      ],
    });
    expect(mixed.dataQualityRating).toBe('D');
    expect(mixed.estimatedDataSharePct).toBe(70);
  });

  it('counts an unresolved line as a warning contributing zero', () => {
    const f = computeProductFootprint({
      ...base,
      lines: [
        line({ id: 'ok', quantity: 10, kgCo2ePerUnit: 2 }),
        line({ id: 'bad', label: 'Mystery input', quantity: 5, kgCo2ePerUnit: null }),
      ],
    });
    expect(f.subtotalKgCo2e).toBe(20);
    expect(f.unresolvedLines).toBe(1);
    expect(f.warnings.some((w) => /Mystery input/.test(w))).toBe(true);
    expect(f.breakdown.find((b) => b.id === 'bad')!.kgCo2e).toBe(0);
  });

  it('is reproducible: same input → same digest, changed input → different', () => {
    const a = computeProductFootprint({ ...base, lines: [line({ quantity: 3, kgCo2ePerUnit: 4 })] });
    const b = computeProductFootprint({ ...base, lines: [line({ quantity: 3, kgCo2ePerUnit: 4 })] });
    const c = computeProductFootprint({ ...base, lines: [line({ quantity: 3, kgCo2ePerUnit: 5 })] });
    expect(a.inputsDigest).toBe(b.inputsDigest);
    expect(a.inputsDigest).not.toBe(c.inputsDigest);
  });

  it('handles a product with no lines', () => {
    const f = computeProductFootprint({ ...base, lines: [] });
    expect(f.subtotalKgCo2e).toBe(0);
    expect(f.totalKgCo2e).toBe(0);
    expect(f.dataQualityRating).toBe('E');
    expect(f.byKind).toEqual([]);
  });
});

describe('pcfDataTierForMethodology', () => {
  it('maps methodologies to tiers', () => {
    expect(pcfDataTierForMethodology('supplier_specific')).toBe('primary');
    expect(pcfDataTierForMethodology('spend_based')).toBe('estimated');
    expect(pcfDataTierForMethodology('average_data')).toBe('secondary');
    expect(pcfDataTierForMethodology(null)).toBe('secondary');
  });
});
