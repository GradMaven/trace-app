import { describe, expect, it } from 'vitest';
import { ANOMALY_DETECTOR_VERSION, detectAnomalies, type SeriesPoint } from './anomaly';

const s = (vals: number[]): SeriesPoint[] =>
  vals.map((v, i) => ({ key: `FY${2019 + i}`, value: v }));

describe('detectAnomalies — mad_outlier', () => {
  it('flags a clear outlier against a stable baseline', () => {
    const found = detectAnomalies(s([100, 102, 98, 101, 99, 260]));
    const mad = found.filter((f) => f.method === 'mad_outlier');
    expect(mad).toHaveLength(1);
    expect(mad[0]!.pointKey).toBe('FY2024');
    expect(mad[0]!.direction).toBe('increase');
    expect(mad[0]!.score).toBeGreaterThan(3.5);
    expect(mad[0]!.explanations.length).toBeGreaterThan(0);
  });

  it('returns nothing for a clean, gently trending series', () => {
    const found = detectAnomalies(s([100, 104, 108, 111, 115, 119]));
    expect(found.filter((f) => f.method === 'mad_outlier')).toEqual([]);
  });

  it('does not run MAD on a series below the minimum length', () => {
    const found = detectAnomalies(s([10, 1000, 12]));
    expect(found.filter((f) => f.method === 'mad_outlier')).toEqual([]);
  });

  it('still catches a lone spike in an otherwise flat series (MAD = 0 fallback)', () => {
    const found = detectAnomalies(s([50, 50, 50, 50, 50, 900]));
    expect(found.some((f) => f.method === 'mad_outlier' && f.pointKey === 'FY2024')).toBe(true);
  });
});

describe('detectAnomalies — relative_change', () => {
  it('flags a period-over-period step beyond the threshold', () => {
    const found = detectAnomalies(s([100, 100, 100, 180]));
    const rc = found.filter((f) => f.method === 'relative_change');
    expect(rc).toHaveLength(1);
    expect(rc[0]!.pointKey).toBe('FY2022');
    expect(rc[0]!.direction).toBe('increase');
    expect(rc[0]!.score).toBeCloseTo(0.8, 5);
  });

  it('respects a custom threshold', () => {
    expect(detectAnomalies(s([100, 130]), { relativeChangeThreshold: 0.5 }).length).toBe(0);
    expect(detectAnomalies(s([100, 130]), { relativeChangeThreshold: 0.2 }).length).toBe(1);
  });

  it('ignores a division-by-zero baseline', () => {
    expect(detectAnomalies(s([0, 100]))).toEqual([]);
  });

  it('flags a sharp drop as a decrease', () => {
    const rc = detectAnomalies(s([200, 200, 60])).filter((f) => f.method === 'relative_change');
    expect(rc[0]!.direction).toBe('decrease');
    expect(rc[0]!.score).toBeLessThan(0);
  });
});

describe('detectAnomalies', () => {
  it('drops non-finite points and is deterministic', () => {
    const a = detectAnomalies(s([100, Number.NaN, 102, 98, 101, 260]));
    const b = detectAnomalies(s([100, Number.NaN, 102, 98, 101, 260]));
    expect(a).toEqual(b);
  });

  it('exposes a version constant', () => {
    expect(ANOMALY_DETECTOR_VERSION).toMatch(/^anomaly-detector@/);
  });
});
