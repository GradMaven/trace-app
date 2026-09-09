import { describe, expect, it } from 'vitest';
import {
  billingPeriodBounds,
  billingPeriodKey,
  crossedSoftWarn,
  DEFAULT_PLAN_KEY,
  evaluateMetric,
  evaluateUsage,
  getPlan,
  isPlanKey,
  USAGE_METRIC_KEYS,
  wouldExceedQuota,
} from './metering';

describe('billing period', () => {
  it('keys by UTC year-month and computes bounds', () => {
    expect(billingPeriodKey(new Date('2026-09-09T23:30:00Z'))).toBe('2026-09');
    expect(billingPeriodKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    const b = billingPeriodBounds('2026-09');
    expect(b.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('plans', () => {
  it('resolves known keys and falls back to the default', () => {
    expect(isPlanKey('growth')).toBe(true);
    expect(isPlanKey('nope')).toBe(false);
    expect(getPlan('nope').key).toBe(DEFAULT_PLAN_KEY);
    expect(getPlan('enterprise').quotas).toEqual({});
  });
});

describe('evaluateMetric', () => {
  const free = getPlan('free');

  it('is ok below the soft-warn line', () => {
    const e = evaluateMetric(free, 'ai_job', 10); // quota 50, warn at 80%
    expect(e).toMatchObject({ used: 10, quota: 50, state: 'ok' });
    expect(e.pct).toBe(20);
  });

  it('warns once usage reaches softWarnPct of quota', () => {
    expect(evaluateMetric(free, 'ai_job', 40).state).toBe('warn'); // 80%
    expect(evaluateMetric(free, 'ai_job', 49).state).toBe('warn');
  });

  it('is over at or above the quota', () => {
    expect(evaluateMetric(free, 'ai_job', 50).state).toBe('over');
    expect(evaluateMetric(free, 'ai_job', 999).state).toBe('over');
  });

  it('treats an unlimited metric as always ok', () => {
    const e = evaluateMetric(getPlan('enterprise'), 'ai_job', 100_000);
    expect(e).toMatchObject({ quota: null, pct: null, state: 'ok' });
  });
});

describe('evaluateUsage', () => {
  it('returns one row per metric, defaulting missing counters to 0', () => {
    const rows = evaluateUsage(getPlan('free'), { ai_job: 40 });
    expect(rows).toHaveLength(USAGE_METRIC_KEYS.length);
    expect(rows.find((r) => r.metric === 'ai_job')!.state).toBe('warn');
    expect(rows.find((r) => r.metric === 'export_job')!.used).toBe(0);
  });
});

describe('quota + soft-warn crossing', () => {
  const free = getPlan('free');
  it('wouldExceedQuota respects the quota and unlimited plans', () => {
    expect(wouldExceedQuota(free, 'export_job', 2, 1)).toBe(false);
    expect(wouldExceedQuota(free, 'export_job', 3, 1)).toBe(true);
    expect(wouldExceedQuota(getPlan('enterprise'), 'export_job', 9999, 1)).toBe(false);
  });

  it('crossedSoftWarn fires exactly on the transition', () => {
    // ai_job quota 50, warn 80% => threshold 40
    expect(crossedSoftWarn(free, 'ai_job', 39, 40)).toBe(true);
    expect(crossedSoftWarn(free, 'ai_job', 40, 41)).toBe(false);
    expect(crossedSoftWarn(free, 'ai_job', 10, 20)).toBe(false);
  });
});
