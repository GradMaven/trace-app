import { type AnomalyMethod } from '@trace/shared';

/**
 * Anomaly detection (brief §9). Pure, deterministic statistics over one metric's
 * series — a datapoint's values across reporting periods, or peer values within
 * a period. Two methods:
 *
 *  - `mad_outlier`      — Iglewicz–Hoaglin modified z-score (median / MAD).
 *  - `relative_change`  — period-over-period step larger than a threshold.
 *
 * Findings carry candidate, heuristic explanations (not AI). The caller
 * persists them as `anomaly` rows for human review.
 */

export const ANOMALY_DETECTOR_VERSION = 'anomaly-detector@1.0.0';

export interface SeriesPoint {
  /** Stable identifier for the point — a reporting-period label or a subject id. */
  key: string;
  value: number;
  /** Optional human label for explanations. */
  label?: string;
}

export interface AnomalyOptions {
  /** Modified z-score above which a point is an outlier (Iglewicz–Hoaglin: 3.5). */
  madThreshold?: number;
  /** Fractional period-over-period change above which a step is flagged (0.5 = ±50%). */
  relativeChangeThreshold?: number;
  /** Minimum points required before MAD is meaningful. */
  minPoints?: number;
}

export interface AnomalyFinding {
  method: AnomalyMethod;
  pointKey: string;
  observedValue: number;
  expectedValue: number;
  /** Modified z-score (mad_outlier) or signed fractional change (relative_change). */
  score: number;
  direction: 'increase' | 'decrease';
  explanations: string[];
}

const DEFAULTS = { madThreshold: 3.5, relativeChangeThreshold: 0.5, minPoints: 4 } as const;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function push(
  out: AnomalyFinding[],
  p: SeriesPoint,
  med: number,
  score: number,
  pointCount: number,
): void {
  const direction = p.value >= med ? 'increase' : 'decrease';
  const ratio = med === 0 ? null : round(p.value / med, 2);
  out.push({
    method: 'mad_outlier',
    pointKey: p.key,
    observedValue: p.value,
    expectedValue: round(med),
    score: round(score),
    direction,
    explanations: [
      `Value ${p.value} deviates ${round(score, 1)}× (modified z-score) from the series median ${round(med)}.`,
      ratio != null ? `That is about ${ratio}× the median.` : 'The series median is zero.',
      pointCount < 6
        ? `Only ${pointCount} points in the series — the baseline is thin.`
        : `Baseline built from ${pointCount} points.`,
    ],
  });
}

function madOutliers(series: SeriesPoint[], opts: Required<AnomalyOptions>): AnomalyFinding[] {
  if (series.length < opts.minPoints) return [];
  const values = series.map((p) => p.value);
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  const out: AnomalyFinding[] = [];

  if (mad === 0) {
    // The bulk of the series is a single constant. Any point that departs from
    // it by more than 2% (or any amount, for an all-zero series) is anomalous.
    const floor = Math.abs(med) * 0.02 + 1e-9;
    for (const p of series) {
      const delta = Math.abs(p.value - med);
      if (delta > floor) push(out, p, med, delta / (Math.abs(med) || 1), series.length);
    }
    return out;
  }

  for (const p of series) {
    const z = (0.6745 * (p.value - med)) / mad;
    if (Math.abs(z) > opts.madThreshold) push(out, p, med, Math.abs(z), series.length);
  }
  return out;
}

function relativeChanges(series: SeriesPoint[], opts: Required<AnomalyOptions>): AnomalyFinding[] {
  const out: AnomalyFinding[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1]!;
    const curr = series[i]!;
    if (prev.value === 0) continue;
    const change = (curr.value - prev.value) / Math.abs(prev.value);
    if (Math.abs(change) > opts.relativeChangeThreshold) {
      const direction = change > 0 ? 'increase' : 'decrease';
      out.push({
        method: 'relative_change',
        pointKey: curr.key,
        observedValue: curr.value,
        expectedValue: prev.value,
        score: round(change),
        direction,
        explanations: [
          `${direction === 'increase' ? 'Rose' : 'Fell'} ${round(Math.abs(change) * 100, 1)}% versus ${prev.label ?? prev.key} (${prev.value} → ${curr.value}).`,
          `Exceeds the ±${round(opts.relativeChangeThreshold * 100)}% step threshold.`,
          'Check for a scope, boundary, unit or methodology change between the two periods.',
        ],
      });
    }
  }
  return out;
}

export function detectAnomalies(
  series: SeriesPoint[],
  options: AnomalyOptions = {},
): AnomalyFinding[] {
  const opts: Required<AnomalyOptions> = { ...DEFAULTS, ...options };
  const clean = series.filter((p) => Number.isFinite(p.value));
  return [...madOutliers(clean, opts), ...relativeChanges(clean, opts)];
}
