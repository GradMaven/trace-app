/**
 * Data-retention policies (Phase 13b) — pure catalogue + evaluation.
 *
 * A policy is `(target, ageDays, enabled)`: rows of `target` older than
 * `ageDays` (by the target's timestamp column) are eligible for deletion.
 *
 * The target list is deliberately narrow: **only operational / derived data**.
 * Evidence, datapoints, calculations, emissions and the audit log carry lineage
 * or are append-only by law and are never retention targets — TRACE keeps the
 * spine forever. `min` is a floor no policy may go below.
 */

export interface RetentionTarget {
  key: string;
  label: string;
  /** The model's created/updated timestamp column used for the age test. */
  dateField: string;
  /** Minimum `ageDays` a policy for this target may set. */
  min: number;
  description: string;
}

export const RETENTION_TARGETS: RetentionTarget[] = [
  {
    key: 'ai_job',
    label: 'AI operation log',
    dateField: 'createdAt',
    min: 90,
    description: 'Model call records (tokens, cost, status). The extracted data is kept.',
  },
  {
    key: 'webhook_delivery',
    label: 'Webhook deliveries',
    dateField: 'createdAt',
    min: 30,
    description: 'Outbound webhook attempts and their responses.',
  },
  {
    key: 'quality_scan',
    label: 'Data-quality scan runs',
    dateField: 'startedAt',
    min: 90,
    description: 'Historical scan run records. Open issues and anomalies are kept.',
  },
  {
    key: 'audit_simulation_run',
    label: 'Audit-readiness simulations',
    dateField: 'startedAt',
    min: 180,
    description: 'Superseded readiness-simulation runs. Findings are kept.',
  },
  {
    key: 'ask_query',
    label: 'Ask TRACE history',
    dateField: 'createdAt',
    min: 30,
    description: 'Natural-language questions and their answers.',
  },
  {
    key: 'integration_run',
    label: 'Import run history',
    dateField: 'startedAt',
    min: 90,
    description: 'CSV / connector import run records. Imported activity data is kept.',
  },
  {
    key: 'export_job',
    label: 'Completed data exports',
    dateField: 'createdAt',
    min: 7,
    description: 'Finished export bundles and their metadata.',
  },
  {
    key: 'usage_event',
    label: 'Usage events',
    dateField: 'occurredAt',
    min: 30,
    description: 'Per-occurrence metering records. Period counters are kept.',
  },
];

const BY_KEY = new Map(RETENTION_TARGETS.map((t) => [t.key, t]));

export function getRetentionTarget(key: string): RetentionTarget | undefined {
  return BY_KEY.get(key);
}

export interface RetentionPolicyInput {
  target: string;
  ageDays: number;
  enabled: boolean;
}

export interface RetentionValidation {
  ok: boolean;
  errors: string[];
}

export function validateRetentionPolicy(input: RetentionPolicyInput): RetentionValidation {
  const errors: string[] = [];
  const target = BY_KEY.get(input.target);
  if (!target) {
    errors.push(`Unknown retention target "${input.target}".`);
  } else if (!Number.isInteger(input.ageDays) || input.ageDays < target.min) {
    errors.push(`${target.label} retention must be a whole number of days ≥ ${target.min}.`);
  } else if (input.ageDays > 3650) {
    errors.push('Retention age cannot exceed 3650 days (10 years).');
  }
  return { ok: errors.length === 0, errors };
}

/** The cutoff instant: rows with `dateField < cutoff` are eligible. */
export function retentionCutoff(ageDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
}

export type RetentionMode = 'dry_run' | 'apply';
