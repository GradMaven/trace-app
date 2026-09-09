import { describe, expect, it } from 'vitest';
import { flattenRequiredDatapoints, getRuleStore, listRuleStoreVersions } from './rule-store';
import './index'; // registers the shipped stores

describe('rule store', () => {
  it('registers esrs@2026.1', () => {
    expect(listRuleStoreVersions()).toContain('esrs@2026.1');
  });

  it('throws a helpful error for an unknown version', () => {
    expect(() => getRuleStore('esrs@1999.0')).toThrow(/Unknown rule-store version/);
  });

  it('every disclosure has at least one required datapoint and evidence requirement', () => {
    const store = getRuleStore('esrs@2026.1');
    for (const req of store.regulation.requirements) {
      for (const dis of req.disclosures) {
        expect(dis.requiredDatapoints.length).toBeGreaterThan(0);
        expect(dis.evidenceRequirements.length).toBeGreaterThan(0);
      }
    }
  });

  it('required-datapoint keys are unique across the store', () => {
    const keys = flattenRequiredDatapoints(getRuleStore('esrs@2026.1')).map((f) => f.datapoint.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is deeply frozen (versioned data, never mutated in place)', () => {
    const store = getRuleStore('esrs@2026.1');
    expect(Object.isFrozen(store)).toBe(true);
    expect(Object.isFrozen(store.regulation.requirements[0])).toBe(true);
    expect(() => {
      // @ts-expect-error — intentional mutation attempt
      store.regulation.requirements[0].code = 'X';
    }).toThrow();
  });
});
