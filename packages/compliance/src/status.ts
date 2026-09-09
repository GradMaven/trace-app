import { COMPLIANCE_STATUS_RANK, type ComplianceStatus } from '@trace/shared';

/**
 * Roll a set of required-datapoint statuses up to a disclosure status.
 *
 * Rules (compliance-architecture.md — never "compliant"):
 *  - any required datapoint `not_started`  → disclosure `not_started`
 *  - else any `review_required`            → disclosure `review_required`
 *  - else the lowest of the remaining ladder states
 *  - no required datapoints                → `not_started`
 */
export function rollUpDisclosureStatus(statuses: readonly ComplianceStatus[]): ComplianceStatus {
  if (statuses.length === 0) return 'not_started';
  if (statuses.some((s) => s === 'not_started')) return 'not_started';
  if (statuses.some((s) => s === 'review_required')) return 'review_required';
  let lowest: ComplianceStatus = 'mapping_complete';
  for (const s of statuses) {
    if (COMPLIANCE_STATUS_RANK[s] < COMPLIANCE_STATUS_RANK[lowest]) lowest = s;
  }
  return lowest;
}

/**
 * Readiness as a percentage: the mean of each required datapoint's ladder
 * progress (`not_started` 0 → `mapping_complete` 1), with `review_required`
 * counted as `data_available` (1/3). Purely indicative — not a compliance claim.
 */
export function readinessPct(statuses: readonly ComplianceStatus[]): number {
  if (statuses.length === 0) return 0;
  const total = statuses.reduce((acc, s) => acc + COMPLIANCE_STATUS_RANK[s] / 3, 0);
  return Math.round((total / statuses.length) * 1000) / 10;
}
