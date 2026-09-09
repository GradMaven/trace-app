import { type ComplianceStatus, type GapReason } from '@trace/shared';
import { rollUpDisclosureStatus, readinessPct } from './status';
import { flattenRequiredDatapoints, type RequiredDatapoint, type RuleStore } from './rule-store';

/**
 * The generic compliance mapping engine (pure). Given a rule store and, per
 * required datapoint, the tenant's candidate company data, it produces an
 * objective status + gap reasons per required datapoint and rolls those up to
 * disclosures. It **suggests**; a permissioned human confirms non-deterministic
 * mappings. It never returns "compliant".
 */

export const DEFAULT_MIN_TRUST_SCORE = 60;
/** Relative gap above which two `single` candidates are treated as conflicting. */
const CONFLICT_REL_TOLERANCE = 0.02;

export interface CandidateEvidence {
  id: string;
  status: string;
  /** ISO date, or null for no expiry. */
  expiresAt: string | null;
}

export interface CandidateDatapoint {
  id: string;
  subjectType: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
  reportingPeriod: string | null;
  calculationId: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** Latest Trust Score for this datapoint, or null if not scored. */
  trustScore: number | null;
  evidence: CandidateEvidence[];
  /** The backing calculation uses an emission factor past its validity window. */
  factorOutdated: boolean;
}

export interface RequiredDatapointInput {
  /** Candidates already filtered to the metric key and reporting period by the caller. */
  candidates: CandidateDatapoint[];
  /** A human has confirmed the mapping for this required datapoint. */
  confirmed: boolean;
}

export interface RequiredDatapointEvaluation {
  requiredDatapointKey: string;
  metricKey: string;
  label: string;
  status: ComplianceStatus;
  gapReasons: GapReason[];
  datapointIds: string[];
  calculationIds: string[];
  evidenceIds: string[];
  value: number | null;
  valueText: string | null;
  trustScore: number | null;
  confirmed: boolean;
}

export interface DisclosureEvaluation {
  regulationKey: string;
  requirementCode: string;
  disclosureCode: string;
  status: ComplianceStatus;
  readinessPct: number;
  requiredDatapoints: RequiredDatapointEvaluation[];
}

export interface RuleStoreEvaluation {
  version: string;
  disclosures: DisclosureEvaluation[];
  requiredDatapoints: RequiredDatapointEvaluation[];
  readinessPct: number;
}

const DEAD_EVIDENCE = new Set(['rejected', 'superseded']);

function unitMatches(required: string | null, actual: string | null): boolean {
  if (!required || !actual) return true;
  const norm = (u: string) => u.trim().toLowerCase().replace('%', 'pct').replace(/\s+/g, '');
  return norm(required) === norm(actual);
}

function resolveValue(
  rd: RequiredDatapoint,
  candidates: CandidateDatapoint[],
): {
  value: number | null;
  valueText: string | null;
  contributing: CandidateDatapoint[];
  conflict: boolean;
} {
  const agg = rd.aggregation ?? 'single';
  const numeric = candidates.filter((c) => c.valueNumeric != null);

  if (agg === 'sum') {
    const value = numeric.reduce((acc, c) => acc + (c.valueNumeric ?? 0), 0);
    return {
      value: numeric.length ? value : null,
      valueText: null,
      contributing: candidates,
      conflict: false,
    };
  }

  if (agg === 'latest') {
    const latest = [...candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      value: latest?.valueNumeric ?? null,
      valueText: latest?.valueText ?? null,
      contributing: latest ? [latest] : [],
      conflict: false,
    };
  }

  // single
  if (candidates.length <= 1) {
    const only = candidates[0];
    return {
      value: only?.valueNumeric ?? null,
      valueText: only?.valueText ?? null,
      contributing: only ? [only] : [],
      conflict: false,
    };
  }
  if (numeric.length > 1) {
    const values = numeric.map((c) => c.valueNumeric as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const base = Math.max(Math.abs(min), Math.abs(max)) || 1;
    if ((max - min) / base > CONFLICT_REL_TOLERANCE) {
      return { value: null, valueText: null, contributing: candidates, conflict: true };
    }
  }
  // Multiple text candidates, or numerically equivalent — take the first.
  return {
    value: candidates[0]!.valueNumeric,
    valueText: candidates[0]!.valueText,
    contributing: [candidates[0]!],
    conflict: false,
  };
}

export function evaluateRequiredDatapoint(
  rd: RequiredDatapoint,
  input: RequiredDatapointInput,
  now: string,
): RequiredDatapointEvaluation {
  const base: RequiredDatapointEvaluation = {
    requiredDatapointKey: rd.key,
    metricKey: rd.metricKey,
    label: rd.label,
    status: 'not_started',
    gapReasons: [],
    datapointIds: [],
    calculationIds: [],
    evidenceIds: [],
    value: null,
    valueText: null,
    trustScore: null,
    confirmed: input.confirmed,
  };

  let candidates = input.candidates;
  if (rd.subjectScope === 'organization') {
    const orgOnly = candidates.filter((c) => c.subjectType === 'organization');
    if (orgOnly.length > 0) candidates = orgOnly;
  }
  if (candidates.length === 0) {
    return { ...base, status: 'not_started', gapReasons: ['missing_data'] };
  }

  const { value, valueText, contributing, conflict } = resolveValue(rd, candidates);
  const gapReasons = new Set<GapReason>();
  const reviewFlags: GapReason[] = [];

  base.datapointIds = contributing.map((c) => c.id);
  base.calculationIds = [
    ...new Set(contributing.map((c) => c.calculationId).filter((x): x is string => !!x)),
  ];
  base.value = value;
  base.valueText = valueText;

  const trustScores = contributing.map((c) => c.trustScore).filter((t): t is number => t != null);
  base.trustScore = trustScores.length ? Math.min(...trustScores) : null;

  const liveEvidence: string[] = [];
  let hasAnyEvidence = false;
  for (const c of contributing) {
    for (const e of c.evidence) {
      hasAnyEvidence = true;
      const dead = DEAD_EVIDENCE.has(e.status);
      const expired = e.expiresAt != null && e.expiresAt < now;
      if (!dead && !expired) liveEvidence.push(e.id);
    }
  }
  base.evidenceIds = [...new Set(liveEvidence)];

  if (conflict) reviewFlags.push('conflicting_data');
  if (contributing.some((c) => c.factorOutdated)) reviewFlags.push('outdated_factor');
  if (contributing.some((c) => !unitMatches(rd.unit, c.unit))) reviewFlags.push('unit_mismatch');
  if (hasAnyEvidence && liveEvidence.length === 0) reviewFlags.push('expired_evidence');

  const minTrust = rd.minTrustScore ?? DEFAULT_MIN_TRUST_SCORE;
  const trustOk = base.trustScore != null && base.trustScore >= minTrust;
  const hasValue = value != null || (valueText != null && valueText !== '');

  let status: ComplianceStatus;
  if (!hasValue && !conflict) {
    status = 'not_started';
    gapReasons.add('missing_data');
  } else if (liveEvidence.length > 0) {
    status = 'evidence_available';
  } else {
    status = 'data_available';
    if (!hasAnyEvidence) gapReasons.add('no_evidence');
  }

  if (status === 'evidence_available') {
    if (!trustOk && base.trustScore != null) gapReasons.add('low_trust_score');
    if (!input.confirmed) {
      gapReasons.add('unconfirmed_mapping');
    } else if (trustOk && reviewFlags.length === 0) {
      status = 'mapping_complete';
    }
  }

  for (const f of reviewFlags) gapReasons.add(f);
  if (reviewFlags.length > 0 && status !== 'not_started') status = 'review_required';

  return { ...base, status, gapReasons: [...gapReasons] };
}

export function evaluateRuleStore(
  store: RuleStore,
  inputByKey: Record<string, RequiredDatapointInput>,
  now: string = new Date().toISOString().slice(0, 10),
): RuleStoreEvaluation {
  const flat = flattenRequiredDatapoints(store);
  const evalByKey = new Map<string, RequiredDatapointEvaluation>();
  for (const f of flat) {
    const input = inputByKey[f.datapoint.key] ?? { candidates: [], confirmed: false };
    evalByKey.set(f.datapoint.key, evaluateRequiredDatapoint(f.datapoint, input, now));
  }

  const disclosures: DisclosureEvaluation[] = [];
  for (const req of store.regulation.requirements) {
    for (const dis of req.disclosures) {
      const rdEvals = dis.requiredDatapoints.map((rd) => evalByKey.get(rd.key)!);
      disclosures.push({
        regulationKey: store.regulation.key,
        requirementCode: req.code,
        disclosureCode: dis.code,
        status: rollUpDisclosureStatus(rdEvals.map((e) => e.status)),
        readinessPct: readinessPct(rdEvals.map((e) => e.status)),
        requiredDatapoints: rdEvals,
      });
    }
  }

  return {
    version: store.version,
    disclosures,
    requiredDatapoints: [...evalByKey.values()],
    readinessPct: readinessPct([...evalByKey.values()].map((e) => e.status)),
  };
}
