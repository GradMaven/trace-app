import {
  DATA_QUALITY_ISSUE_KIND,
  type DataQualityIssueKind,
  type IssueSeverity,
  type Methodology,
  type Provenance,
} from '@trace/shared';

/**
 * Data-quality check engine (brief §9, docs/domain-model.md "Trust & Quality").
 *
 * Pure, deterministic rules over a single datapoint plus its peers (other
 * datapoints for the same metric). Each rule returns zero or more findings; the
 * caller (packages/db) persists them as `data_quality_issue` rows, refreshing
 * `lastSeenAt` on a re-scan and auto-resolving issues that are no longer
 * detected. No AI, no I/O.
 */

export const QUALITY_RULES_VERSION = 'quality-rules@1.0.0';

export interface QualityEvidenceRef {
  status: string;
  expiresAt: string | null;
  verified: boolean;
}

export interface QualityFactorRef {
  recognisedSource: boolean;
  validTo: string | null;
  asOf: string;
}

export interface QualityDatapoint {
  id: string;
  metricKey: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
  unitResolves: boolean;
  provenance: Provenance;
  label: string;
  reportingPeriod: string | null;
  subjectType: string;
  subjectId: string;
  createdAt: string;
  evidence: QualityEvidenceRef[];
  factor: QualityFactorRef | null;
  methodology: Methodology | null;
}

export interface QualityPeer {
  id: string;
  metricKey: string;
  subjectType: string;
  subjectId: string;
  reportingPeriod: string | null;
  valueNumeric: number | null;
  unit: string | null;
  provenance: Provenance;
}

export interface QualityContext {
  /** ISO date treated as "now" for staleness / expiry. */
  now: string;
  /** A datapoint older than this many days is stale. */
  staleAfterDays: number;
  /** Other datapoints for the SAME metricKey (all subjects), excluding this one. */
  peers: QualityPeer[];
}

export interface QualityFinding {
  kind: DataQualityIssueKind;
  severity: IssueSeverity;
  title: string;
  detail: string;
  facts: Record<string, unknown>;
}

const DIMENSIONLESS_SUFFIXES = [
  '_pct',
  '_ratio',
  '_count',
  '_score',
  '_certified',
  '_exists',
  '_index',
];
const PERCENTAGE_SUFFIXES = ['_pct'];

function hasSuffix(key: string, suffixes: string[]): boolean {
  return suffixes.some((s) => key.endsWith(s));
}

export function metricIsPercentage(metricKey: string): boolean {
  return hasSuffix(metricKey, PERCENTAGE_SUFFIXES);
}

export function metricIsDimensionless(metricKey: string): boolean {
  return hasSuffix(metricKey, DIMENSIONLESS_SUFFIXES);
}

/** Emissions, energy, mass, volume, distance and percentages must not be negative. */
export function metricIsNonNegative(metricKey: string): boolean {
  return (
    metricKey.startsWith('emission_') ||
    metricIsPercentage(metricKey) ||
    hasSuffix(metricKey, [
      '_tco2e',
      '_co2e',
      '_mwh',
      '_kwh',
      '_gj',
      '_m3',
      '_kg',
      '_t',
      '_km',
      '_l',
    ])
  );
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.abs(a - b) / 86_400_000;
}

function relDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 ? 0 : Math.abs(a - b) / base;
}

type Rule = (dp: QualityDatapoint, ctx: QualityContext) => QualityFinding[];

const missingValue: Rule = (dp) => {
  const hasText = dp.valueText != null && dp.valueText.trim() !== '';
  if (dp.valueNumeric == null && !hasText) {
    return [
      {
        kind: 'missing_value',
        severity: 'critical',
        title: `${dp.metricKey} has no value`,
        detail: 'The datapoint carries neither a numeric nor a text value.',
        facts: {},
      },
    ];
  }
  return [];
};

const missingUnit: Rule = (dp) => {
  if (dp.valueNumeric != null && !dp.unit && !metricIsDimensionless(dp.metricKey)) {
    return [
      {
        kind: 'missing_unit',
        severity: 'warning',
        title: `${dp.metricKey} is missing a unit`,
        detail: 'A numeric datapoint for a dimensional metric should record its unit.',
        facts: { value: dp.valueNumeric },
      },
    ];
  }
  return [];
};

const missingEvidence: Rule = (dp) => {
  if (dp.evidence.length === 0) {
    return [
      {
        kind: 'missing_evidence',
        severity: dp.provenance === 'measured' ? 'info' : 'warning',
        title: `${dp.metricKey} has no supporting evidence`,
        detail: 'Evidence before reporting (Principle 1): link at least one document or record.',
        facts: { provenance: dp.provenance },
      },
    ];
  }
  return [];
};

const unverifiedEvidence: Rule = (dp) => {
  if (dp.evidence.length > 0 && dp.label !== 'verified' && !dp.evidence.some((e) => e.verified)) {
    return [
      {
        kind: 'unverified_evidence',
        severity: 'info',
        title: `${dp.metricKey} rests on unverified evidence`,
        detail: 'None of the linked evidence records has passed verification.',
        facts: { evidenceCount: dp.evidence.length },
      },
    ];
  }
  return [];
};

const expiredEvidence: Rule = (dp, ctx) => {
  const expired = dp.evidence.filter((e) => e.expiresAt != null && e.expiresAt < ctx.now);
  const live = dp.evidence.filter((e) => e.expiresAt == null || e.expiresAt >= ctx.now);
  if (expired.length > 0 && live.length === 0) {
    return [
      {
        kind: 'expired_evidence',
        severity: 'warning',
        title: `${dp.metricKey}: all supporting evidence has expired`,
        detail: `${expired.length} linked evidence record(s) are past their expiry date and none is current.`,
        facts: {
          expiredCount: expired.length,
          earliest: expired.map((e) => e.expiresAt).sort()[0],
        },
      },
    ];
  }
  return [];
};

const staleData: Rule = (dp, ctx) => {
  const age = daysBetween(dp.createdAt, ctx.now);
  if (age > ctx.staleAfterDays) {
    return [
      {
        kind: 'stale_data',
        severity: 'warning',
        title: `${dp.metricKey} has not been refreshed in ${Math.round(age)} days`,
        detail: `Older than the ${ctx.staleAfterDays}-day freshness threshold.`,
        facts: { ageDays: Math.round(age), createdAt: dp.createdAt },
      },
    ];
  }
  return [];
};

const unitInconsistency: Rule = (dp, ctx) => {
  if (!dp.unit) return [];
  const units = new Set<string>([dp.unit]);
  for (const p of ctx.peers) if (p.unit) units.add(p.unit);
  if (units.size > 1) {
    return [
      {
        kind: 'unit_inconsistency',
        severity: 'warning',
        title: `${dp.metricKey} is recorded in ${units.size} different units`,
        detail: 'Datapoints for one metric should share a unit (or be convertible and normalised).',
        facts: { units: [...units].sort() },
      },
    ];
  }
  return [];
};

const impossibleValue: Rule = (dp) => {
  const out: QualityFinding[] = [];
  const v = dp.valueNumeric;
  if (v != null) {
    if (metricIsPercentage(dp.metricKey) && (v < 0 || v > 100)) {
      out.push({
        kind: 'impossible_value',
        severity: 'critical',
        title: `${dp.metricKey} = ${v} is outside 0–100%`,
        detail: 'A percentage metric must lie between 0 and 100.',
        facts: { value: v },
      });
    } else if (metricIsNonNegative(dp.metricKey) && v < 0) {
      out.push({
        kind: 'impossible_value',
        severity: 'critical',
        title: `${dp.metricKey} = ${v} is negative`,
        detail: 'This metric cannot be negative.',
        facts: { value: v },
      });
    }
  }
  if (dp.unit && !dp.unitResolves) {
    out.push({
      kind: 'impossible_value',
      severity: 'warning',
      title: `${dp.metricKey}: unit "${dp.unit}" is not recognised`,
      detail:
        'The unit does not resolve in the TRACE unit registry, so the value cannot be converted.',
      facts: { unit: dp.unit },
    });
  }
  return out;
};

const duplicate: Rule = (dp, ctx) => {
  const value = dp.valueNumeric;
  if (value == null) return [];
  const twin = ctx.peers.find(
    (p) =>
      p.subjectType === dp.subjectType &&
      p.subjectId === dp.subjectId &&
      (p.reportingPeriod ?? null) === (dp.reportingPeriod ?? null) &&
      (p.unit ?? null) === (dp.unit ?? null) &&
      p.valueNumeric != null &&
      relDiff(p.valueNumeric, value) <= 0.005,
  );
  if (twin) {
    return [
      {
        kind: 'duplicate',
        severity: 'warning',
        title: `${dp.metricKey} appears to be duplicated`,
        detail: 'Another datapoint for the same subject, period and unit holds the same value.',
        facts: { peerId: twin.id, value: dp.valueNumeric },
      },
    ];
  }
  return [];
};

const conflictingSupplierReport: Rule = (dp, ctx) => {
  const value = dp.valueNumeric;
  if (dp.subjectType !== 'supplier' || dp.provenance !== 'supplier_reported' || value == null) {
    return [];
  }
  const conflict = ctx.peers.find(
    (p): p is QualityPeer & { valueNumeric: number } =>
      p.subjectType === 'supplier' &&
      p.subjectId === dp.subjectId &&
      p.provenance === 'supplier_reported' &&
      (p.reportingPeriod ?? null) === (dp.reportingPeriod ?? null) &&
      (p.unit ?? null) === (dp.unit ?? null) &&
      p.valueNumeric != null &&
      relDiff(p.valueNumeric, value) > 0.05,
  );
  if (conflict) {
    return [
      {
        kind: 'conflicting_supplier_report',
        severity: 'warning',
        title: `${dp.metricKey}: supplier reported conflicting values`,
        detail: 'Two supplier-reported datapoints for the same period differ by more than 5%.',
        facts: {
          peerId: conflict.id,
          values: [value, conflict.valueNumeric].sort((a, b) => a - b),
        },
      },
    ];
  }
  return [];
};

const outdatedFactor: Rule = (dp) => {
  if (!dp.factor) return [];
  const out: QualityFinding[] = [];
  if (dp.factor.validTo != null && dp.factor.validTo < dp.factor.asOf) {
    out.push({
      kind: 'outdated_factor',
      severity: 'warning',
      title: `${dp.metricKey} uses an emission factor past its validity`,
      detail: `The factor expired ${dp.factor.validTo}, before the activity date ${dp.factor.asOf}.`,
      facts: { validTo: dp.factor.validTo, asOf: dp.factor.asOf },
    });
  }
  if (!dp.factor.recognisedSource) {
    out.push({
      kind: 'outdated_factor',
      severity: 'info',
      title: `${dp.metricKey} uses an unrecognised emission-factor source`,
      detail: 'The factor source is not on the recognised list; confirm it is appropriate.',
      facts: {},
    });
  }
  return out;
};

const lowMethodologyTier: Rule = (dp) => {
  if (dp.methodology === 'spend_based') {
    return [
      {
        kind: 'low_methodology_tier',
        severity: 'info',
        title: `${dp.metricKey} is spend-based`,
        detail:
          'Spend-based estimates are the lowest primary-data tier; prefer activity or supplier data where available.',
        facts: { methodology: dp.methodology },
      },
    ];
  }
  return [];
};

const RULES: Record<DataQualityIssueKind, Rule> = {
  missing_value: missingValue,
  missing_unit: missingUnit,
  missing_evidence: missingEvidence,
  unverified_evidence: unverifiedEvidence,
  expired_evidence: expiredEvidence,
  stale_data: staleData,
  unit_inconsistency: unitInconsistency,
  impossible_value: impossibleValue,
  duplicate,
  conflicting_supplier_report: conflictingSupplierReport,
  outdated_factor: outdatedFactor,
  low_methodology_tier: lowMethodologyTier,
};

export function evaluateDatapointQuality(
  dp: QualityDatapoint,
  ctx: QualityContext,
): QualityFinding[] {
  return DATA_QUALITY_ISSUE_KIND.flatMap((kind) => RULES[kind](dp, ctx));
}
