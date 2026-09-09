import { describe, expect, it } from 'vitest';
import { CsvActivityAdapter } from './csv-activity';
import { getIntegrationAdapter, listIntegrationAdapters } from './registry';
import type { ColumnMapping, ImportDefaults } from './adapter';

const ORG = '00000000-0000-4000-8000-0000000000d1';
const adapter = new CsvActivityAdapter();

const HEADER = 'scope,category,value,unit,period,subject_id';
const identityMap: ColumnMapping = {
  scope: { column: 'scope' },
  category: { column: 'category' },
  value: { column: 'value' },
  unit: { column: 'unit' },
  reportingPeriod: { column: 'period' },
  subjectId: { column: 'subject_id' },
};
const defaults: ImportDefaults = { subjectType: 'organization' };

describe('CsvActivityAdapter.preview', () => {
  it('maps valid rows and reports a summary', () => {
    const text = `${HEADER}
scope_1,Natural gas,4200000,kWh,FY2025,${ORG}
scope_2_location,Grid electricity,12400000,kWh,FY2025,${ORG}`;
    const p = adapter.preview({ text, mapping: identityMap, defaults });
    expect(p.summary).toEqual({ total: 2, valid: 2, invalid: 0 });
    expect(p.rows[0]!.mapped).toMatchObject({
      scope: 'scope_1',
      category: 'Natural gas',
      value: 4200000,
      unit: 'kWh',
      reportingPeriod: 'FY2025',
      subjectType: 'organization',
      subjectId: ORG,
    });
  });

  it('flags a bad unit, a bad scope, a non-numeric value and a missing required field', () => {
    const text = `${HEADER}
not_a_scope,X,10,kWh,FY2025,${ORG}
scope_1,X,ten,kWh,FY2025,${ORG}
scope_1,X,10,widgets,FY2025,${ORG}
scope_1,,10,kWh,FY2025,${ORG}`;
    const p = adapter.preview({ text, mapping: identityMap, defaults });
    expect(p.summary.valid).toBe(0);
    expect(p.rows[0]!.errors.join()).toMatch(/scope/i);
    expect(p.rows[1]!.errors.join()).toMatch(/not a non-negative number/i);
    expect(p.rows[2]!.errors.join()).toMatch(/unit registry/i);
    expect(p.rows[3]!.errors.join()).toMatch(/category is missing/i);
    expect(p.rows.every((r) => r.mapped === null)).toBe(true);
  });

  it('supports constant mappings and import defaults', () => {
    const text = `category,value,unit\nSteel,1000,t`;
    const p = adapter.preview({
      text,
      mapping: {
        category: { column: 'category' },
        value: { column: 'value' },
        unit: { column: 'unit' },
        scope: { constant: 'scope_3' },
        ghgCategory: { constant: 'cat_1_purchased_goods_services' },
      },
      defaults: {
        reportingPeriod: 'FY2025',
        subjectType: 'organization',
        subjectId: ORG,
        provenance: 'estimated',
      },
    });
    expect(p.rows[0]!.errors).toEqual([]);
    expect(p.rows[0]!.mapped).toMatchObject({
      scope: 'scope_3',
      ghgCategory: 'cat_1_purchased_goods_services',
      reportingPeriod: 'FY2025',
      provenance: 'estimated',
      subjectId: ORG,
    });
  });

  it('validates optional occurredOn and supplierId formats', () => {
    const text = `${HEADER},occurred,sup\nscope_1,X,10,kWh,FY2025,${ORG},2025-13-40,not-a-uuid`;
    const p = adapter.preview({
      text,
      mapping: {
        ...identityMap,
        occurredOn: { column: 'occurred' },
        supplierId: { column: 'sup' },
      },
      defaults,
    });
    expect(p.rows[0]!.errors.join()).toMatch(/YYYY-MM-DD/);
    expect(p.rows[0]!.errors.join()).toMatch(/Supplier id/i);
  });

  it('is deterministic', () => {
    const text = `${HEADER}\nscope_1,X,10,kWh,FY2025,${ORG}`;
    expect(adapter.preview({ text, mapping: identityMap, defaults })).toEqual(
      adapter.preview({ text, mapping: identityMap, defaults }),
    );
  });
});

describe('registry', () => {
  it('exposes csv_activity with its target fields', () => {
    const list = listIntegrationAdapters();
    expect(list.map((a) => a.kind)).toContain('csv_activity');
    const csv = getIntegrationAdapter('csv_activity');
    expect(csv.targetFields().find((f) => f.key === 'unit')?.required).toBe(true);
  });

  it('throws for an unknown kind', () => {
    expect(() => getIntegrationAdapter('sap_pull')).toThrow(/Unknown integration kind/);
  });
});
