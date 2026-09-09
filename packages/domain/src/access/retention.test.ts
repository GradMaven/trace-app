import { describe, expect, it } from 'vitest';
import {
  getRetentionTarget,
  RETENTION_TARGETS,
  retentionCutoff,
  validateRetentionPolicy,
} from './retention';

describe('retention targets', () => {
  it('are all operational/derived — never lineage or the audit log', () => {
    const keys = RETENTION_TARGETS.map((t) => t.key);
    for (const forbidden of ['evidence', 'calculation', 'datapoint', 'emission', 'audit_log']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys).toContain('ai_job');
    expect(keys).toContain('webhook_delivery');
  });
});

describe('validateRetentionPolicy', () => {
  it('accepts an in-range policy', () => {
    expect(validateRetentionPolicy({ target: 'ai_job', ageDays: 365, enabled: true }).ok).toBe(
      true,
    );
  });

  it('rejects an unknown target, a below-floor age, and a non-integer', () => {
    expect(validateRetentionPolicy({ target: 'evidence', ageDays: 365, enabled: true }).ok).toBe(
      false,
    );
    const floor = getRetentionTarget('ai_job')!.min;
    expect(
      validateRetentionPolicy({ target: 'ai_job', ageDays: floor - 1, enabled: true }).ok,
    ).toBe(false);
    expect(validateRetentionPolicy({ target: 'ai_job', ageDays: 90.5, enabled: true }).ok).toBe(
      false,
    );
  });

  it('rejects an absurdly long age', () => {
    expect(validateRetentionPolicy({ target: 'ask_query', ageDays: 4000, enabled: true }).ok).toBe(
      false,
    );
  });
});

describe('retentionCutoff', () => {
  it('is `now` minus ageDays', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(retentionCutoff(30, now).toISOString()).toBe('2026-05-02T00:00:00.000Z');
  });
});
