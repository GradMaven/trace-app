/**
 * Detailed health report shape + roll-up (Phase 13d) — pure. The API fills the
 * checks (DB round-trip, worker heartbeat age, Redis config, storage driver);
 * this decides the overall status.
 */

export type CheckStatus = 'up' | 'down' | 'degraded';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthReport {
  status: HealthStatus;
  version: string;
  uptimeSeconds: number;
  generatedAt: string;
  checks: HealthCheck[];
}

/** `down` anywhere → unhealthy; else any `degraded` → degraded; else healthy. */
export function rollUpHealth(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === 'down')) return 'unhealthy';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  return 'healthy';
}

export function buildHealthReport(input: {
  version: string;
  uptimeSeconds: number;
  checks: HealthCheck[];
  now?: Date;
}): HealthReport {
  return {
    status: rollUpHealth(input.checks),
    version: input.version,
    uptimeSeconds: Math.round(input.uptimeSeconds),
    generatedAt: (input.now ?? new Date()).toISOString(),
    checks: input.checks,
  };
}

/** Classify a heartbeat by age: fresh → up, stale → degraded, very stale / missing → down. */
export function heartbeatStatus(
  beatAt: Date | null,
  now: Date = new Date(),
  degradedAfterSeconds = 120,
  downAfterSeconds = 600,
): { status: CheckStatus; ageSeconds: number | null } {
  if (!beatAt) return { status: 'down', ageSeconds: null };
  const ageSeconds = Math.round((now.getTime() - beatAt.getTime()) / 1000);
  if (ageSeconds > downAfterSeconds) return { status: 'down', ageSeconds };
  if (ageSeconds > degradedAfterSeconds) return { status: 'degraded', ageSeconds };
  return { status: 'up', ageSeconds };
}
