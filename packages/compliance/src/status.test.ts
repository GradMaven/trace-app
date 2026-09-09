import { describe, expect, it } from 'vitest';
import { readinessPct, rollUpDisclosureStatus } from './status';

describe('rollUpDisclosureStatus', () => {
  it('is not_started when any required datapoint is missing', () => {
    expect(rollUpDisclosureStatus(['mapping_complete', 'not_started', 'evidence_available'])).toBe(
      'not_started',
    );
  });

  it('is review_required when something needs judgement and nothing is missing', () => {
    expect(rollUpDisclosureStatus(['evidence_available', 'review_required'])).toBe(
      'review_required',
    );
  });

  it('otherwise takes the lowest ladder state', () => {
    expect(rollUpDisclosureStatus(['mapping_complete', 'evidence_available'])).toBe(
      'evidence_available',
    );
    expect(rollUpDisclosureStatus(['mapping_complete', 'mapping_complete'])).toBe(
      'mapping_complete',
    );
  });

  it('is not_started for an empty disclosure', () => {
    expect(rollUpDisclosureStatus([])).toBe('not_started');
  });
});

describe('readinessPct', () => {
  it('spans 0 for all-missing to 100 for all-complete', () => {
    expect(readinessPct(['not_started', 'not_started'])).toBe(0);
    expect(readinessPct(['mapping_complete', 'mapping_complete'])).toBe(100);
  });

  it('averages ladder progress', () => {
    // evidence_available = 2/3, data_available = 1/3 → mean 0.5 → 50%
    expect(readinessPct(['evidence_available', 'data_available'])).toBe(50);
  });
});
