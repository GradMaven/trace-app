import { describe, expect, it } from 'vitest';
import { projectScenario, type ScenarioLineInput } from './scenario';

function line(over: Partial<ScenarioLineInput> = {}): ScenarioLineInput {
  return {
    supplierId: 's1',
    supplierName: 'Steel Co',
    label: 'Purchased steel',
    activityValue: 1000,
    activityUnit: 't',
    factorValue: 2.1,
    factorNumeratorUnit: 'tCO2e',
    factorDenominatorUnit: 't',
    gwpSet: 'AR6',
    methodology: 'average_data',
    ...over,
  };
}

describe('projectScenario', () => {
  it('reproduces the baseline when there are no changes', () => {
    const r = projectScenario([line()], []);
    // 1000 t × 2.1 tCO2e/t
    expect(r.baselineTco2e).toBe('2100');
    expect(r.projectedTco2e).toBe('2100');
    expect(r.deltaTco2e).toBe('0');
    expect(r.deltaPct).toBe('0');
    expect(r.lines[0]!.changed).toBe(false);
  });

  it('cuts activity volume', () => {
    const r = projectScenario([line()], [{ supplierId: 's1', activityMultiplier: 0.8 }]);
    expect(r.projectedTco2e).toBe('1680'); // 800 × 2.1
    expect(r.deltaTco2e).toBe('-420');
    expect(r.deltaPct).toBe('-20');
    expect(r.lines[0]!.note).toContain('activity ×0.8');
  });

  it('switches to a cleaner factor', () => {
    const r = projectScenario(
      [line()],
      [{ supplierId: 's1', factorValue: 1.6, methodology: 'supplier_specific' }],
    );
    expect(r.projectedTco2e).toBe('1600');
    expect(r.deltaTco2e).toBe('-500');
    expect(r.lines[0]!.note).toContain('factor 2.1 → 1.6');
    expect(r.lines[0]!.note).toContain('methodology → supplier_specific');
  });

  it('drops a line entirely', () => {
    const r = projectScenario(
      [line({ supplierId: 'a' }), line({ supplierId: 'b', supplierName: 'B', activityValue: 500 })],
      [{ supplierId: 'b', drop: true }],
    );
    expect(r.baselineTco2e).toBe('3150'); // 2100 + 1050
    expect(r.projectedTco2e).toBe('2100');
    expect(r.lines.find((l) => l.supplierId === 'b')!.note).toBe('line removed');
  });

  it('aggregates deltas across multiple lines and is exact', () => {
    const r = projectScenario(
      [
        line({ supplierId: 'a', activityValue: 1000 }),
        line({
          supplierId: 'b',
          supplierName: 'Freight',
          label: 'Road freight',
          activityValue: 2_000_000,
          activityUnit: 't.km',
          factorValue: 0.107,
          factorNumeratorUnit: 'kgCO2e',
          factorDenominatorUnit: 't.km',
          methodology: 'distance_based',
        }),
      ],
      [
        { supplierId: 'a', factorValue: 2.0 },
        { supplierId: 'b', activityMultiplier: 0.5 },
      ],
    );
    // a: 2100 → 2000 (−100); b: 214 → 107 (−107)
    expect(r.baselineTco2e).toBe('2314');
    expect(r.projectedTco2e).toBe('2107');
    expect(r.deltaTco2e).toBe('-207');
  });

  it('is deterministic', () => {
    const lines = [line()];
    const changes = [{ supplierId: 's1', activityMultiplier: 0.9 }];
    expect(projectScenario(lines, changes)).toEqual(projectScenario(lines, changes));
  });
});
