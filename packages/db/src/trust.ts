import { createHash } from 'node:crypto';
import {
  ANOMALY_DETECTOR_VERSION,
  QUALITY_RULES_VERSION,
  TRUST_MODEL_VERSION,
  canonicalJson,
  detectAnomalies,
  evaluateDatapointQuality,
  isCo2eUnit,
  metricIsDimensionless,
  periodYear,
  scoreDatapoint,
  unitDimension,
  type AnomalyFinding,
  type QualityDatapoint,
  type QualityFinding,
  type QualityPeer,
  type SeriesPoint,
  type TrustInput,
} from '@trace/domain';
import { AppError, type AnomalyStatus, type IssueStatus } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Trust Engine operations (Phase 6). All scoring and detection logic is pure and
 * lives in @trace/domain; this module gathers each datapoint's context (evidence,
 * calculation, factor, peers), persists the immutable `trust_score`, and manages
 * `data_quality_issue` / `anomaly` rows with idempotent re-scans. `db` must
 * already be a tenant transaction.
 */

const DEFAULT_GWP_SET = 'AR6';
const STALE_AFTER_DAYS = 400;
const MAX_ANOMALIES_PER_SCAN = 200;

/** Emission-factor sources TRACE recognises as suitable provenance for reporting. */
const RECOGNISED_FACTOR_SOURCES = new Set([
  'DEFRA',
  'BEIS',
  'ADEME',
  'BASE CARBONE',
  'IEA',
  'EPA',
  'GHG PROTOCOL',
  'ECOINVENT',
  'EXIOBASE',
  'IPCC',
  'UBA',
  'EEA',
  'GEMIS',
  'CLIMATIQ',
  'IDEMAT',
]);

function isRecognisedSource(source: string): boolean {
  return RECOGNISED_FACTOR_SOURCES.has(source.trim().toUpperCase());
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safeUnitResolves(unit: string | null): boolean {
  if (!unit) return true;
  if (isCo2eUnit(unit)) return true;
  try {
    unitDimension(unit);
    return true;
  } catch {
    return false;
  }
}

function digestOf(input: TrustInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/** Active reporting period: the scan's period if given, else org config, else FY(lastYear). */
function resolveActivePeriod(configured: unknown, explicit: string | undefined): string {
  if (explicit) return explicit;
  if (configured && typeof configured === 'object' && 'activePeriod' in configured) {
    const v = (configured as { activePeriod?: unknown }).activePeriod;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return `FY${new Date().getFullYear() - 1}`;
}

// ---------------------------------------------------------------------------
// Trust Score
// ---------------------------------------------------------------------------

type DatapointWithContext = Prisma.DatapointGetPayload<{
  include: {
    evidence: { include: { evidence: { include: { verifications: true } } } };
    calculation: { include: { emissionFactor: true; activity: true } };
  };
}>;

function buildTrustInput(dp: DatapointWithContext, activePeriod: string): TrustInput {
  const evidence = dp.evidence.map((link) => {
    const ev = link.evidence;
    const verified =
      ev.status === 'verified' ||
      ev.verifications.some((v) => /pass|verif|confirm|approv/i.test(v.outcome));
    return {
      status: ev.status as string,
      expiresAt: ev.expiresAt ? isoDate(ev.expiresAt) : null,
      verified,
    };
  });

  let methodology: TrustInput['methodology'] = null;
  let factor: TrustInput['factor'] = null;
  if (dp.calculation) {
    methodology = dp.calculation.methodology;
    const ef = dp.calculation.emissionFactor;
    const occurredOn = dp.calculation.activity?.occurredOn ?? null;
    const asOf = occurredOn
      ? isoDate(occurredOn)
      : `${periodYear(dp.calculation.reportingPeriod) ?? new Date().getFullYear()}-12-31`;
    factor = {
      recognisedSource: isRecognisedSource(ef.source),
      validFrom: isoDate(ef.validFrom),
      validTo: ef.validTo ? isoDate(ef.validTo) : null,
      gwpSet: ef.gwpSet,
      expectedGwpSet: DEFAULT_GWP_SET,
      asOf,
    };
  }

  const companionFields = [
    { key: 'unit', present: Boolean(dp.unit) || metricIsDimensionless(dp.metricKey) },
    { key: 'reportingPeriod', present: Boolean(dp.reportingPeriod) },
    { key: 'evidence', present: dp.evidence.length > 0 },
  ];
  if (dp.calculation) companionFields.push({ key: 'methodology', present: Boolean(methodology) });

  return {
    provenance: dp.provenance,
    label: dp.label as TrustInput['label'],
    unit: dp.unit,
    unitResolves: safeUnitResolves(dp.unit),
    valuePresent: dp.valueNumeric != null || (dp.valueText != null && dp.valueText !== ''),
    methodology,
    reportingPeriod: dp.reportingPeriod,
    activeReportingPeriod: activePeriod,
    evidence,
    factor,
    companionFields,
  };
}

export interface TrustScoreOutcome {
  trustScoreId: string;
  datapointId: string;
  value: number;
  band: string;
  unchanged: boolean;
}

async function persistTrustScore(
  db: TenantDb,
  organizationId: string,
  dp: DatapointWithContext,
  activePeriod: string,
  actorUserId: string | undefined,
): Promise<TrustScoreOutcome> {
  const input = buildTrustInput(dp, activePeriod);
  const result = scoreDatapoint(input);
  const digest = digestOf(input);

  const current = await db.trustScore.findFirst({
    where: { organizationId, datapointId: dp.id, supersededBy: { none: {} } },
    orderBy: { computedAt: 'desc' },
  });
  if (current && current.inputsDigest === digest && current.modelVersion === result.modelVersion) {
    return {
      trustScoreId: current.id,
      datapointId: dp.id,
      value: current.value,
      band: current.band,
      unchanged: true,
    };
  }

  const row = await db.trustScore.create({
    data: {
      organizationId,
      datapointId: dp.id,
      subjectType: dp.subjectType,
      subjectId: dp.subjectId,
      metricKey: dp.metricKey,
      reportingPeriod: dp.reportingPeriod,
      value: result.value,
      band: result.band as never,
      breakdown: result.breakdown as unknown as Prisma.InputJsonValue,
      modelVersion: result.modelVersion,
      inputsDigest: digest,
      supersedesId: current?.id ?? null,
      computedByUserId: actorUserId ?? null,
    },
  });
  return {
    trustScoreId: row.id,
    datapointId: dp.id,
    value: result.value,
    band: result.band,
    unchanged: false,
  };
}

export interface ScoreDatapointTrustArgs {
  organizationId: string;
  datapointId: string;
  actorUserId?: string;
  requestId: string;
  activeReportingPeriod?: string;
}

/** Score (or re-score) one datapoint. Writes an audit entry when the score changes. */
export async function scoreDatapointTrust(
  db: TenantDb,
  args: ScoreDatapointTrustArgs,
): Promise<TrustScoreOutcome> {
  const dp = await db.datapoint.findFirst({
    where: { id: args.datapointId, organizationId: args.organizationId },
    include: {
      evidence: { include: { evidence: { include: { verifications: true } } } },
      calculation: { include: { emissionFactor: true, activity: true } },
    },
  });
  if (!dp) throw AppError.notFound('datapoint.not_found', 'Datapoint not found.');

  const org = await db.organization.findUniqueOrThrow({ where: { id: args.organizationId } });
  const activePeriod = resolveActivePeriod(org.reportingPeriodConfig, args.activeReportingPeriod);

  const outcome = await persistTrustScore(
    db,
    args.organizationId,
    dp,
    activePeriod,
    args.actorUserId,
  );

  if (!outcome.unchanged) {
    await writeAuditLog(db, {
      organizationId: args.organizationId,
      actorId: args.actorUserId ?? null,
      action: 'trust.scored',
      resourceType: 'datapoint',
      resourceId: dp.id,
      before: null,
      after: { trustScoreId: outcome.trustScoreId, value: outcome.value, band: outcome.band },
      requestId: args.requestId,
    });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Data-quality scan
// ---------------------------------------------------------------------------

function issueDedupeKey(f: {
  kind: string;
  subjectType: string;
  subjectId: string;
  metricKey: string | null;
  reportingPeriod: string | null;
}): string {
  return [f.kind, f.subjectType, f.subjectId, f.metricKey ?? '', f.reportingPeriod ?? ''].join('|');
}

function anomalyDedupeKey(a: {
  method: string;
  subjectType: string;
  subjectId: string;
  metricKey: string;
  pointKey: string;
}): string {
  return [a.method, a.subjectType, a.subjectId, a.metricKey, a.pointKey].join('|');
}

interface PoolRow {
  id: string;
  metricKey: string;
  subjectType: string;
  subjectId: string;
  reportingPeriod: string | null;
  valueNumeric: Prisma.Decimal | null;
  unit: string | null;
  provenance: string;
}

export interface RunQualityScanArgs {
  organizationId: string;
  reportingPeriod?: string;
  actorUserId?: string;
  requestId: string;
}

export interface QualityScanResult {
  scanId: string;
  datapointsScored: number;
  avgTrustScore: number | null;
  trustChanged: number;
  issuesOpened: number;
  issuesResolved: number;
  issuesOpen: number;
  anomaliesFound: number;
}

export async function runQualityScan(
  db: TenantDb,
  args: RunQualityScanArgs,
): Promise<QualityScanResult> {
  const { organizationId, reportingPeriod } = args;
  const startedAt = Date.now();

  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const activePeriod = resolveActivePeriod(org.reportingPeriodConfig, reportingPeriod);

  const scan = await db.qualityScan.create({
    data: {
      organizationId,
      reportingPeriod: reportingPeriod ?? null,
      modelVersion: TRUST_MODEL_VERSION,
      rulesVersion: QUALITY_RULES_VERSION,
      detectorVersion: ANOMALY_DETECTOR_VERSION,
      ranByUserId: args.actorUserId ?? null,
    },
  });

  const scanned = await db.datapoint.findMany({
    where: { organizationId, ...(reportingPeriod ? { reportingPeriod } : {}) },
    include: {
      evidence: { include: { evidence: { include: { verifications: true } } } },
      calculation: { include: { emissionFactor: true, activity: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Peer pool: every datapoint in the org, lean — used for cross-datapoint checks.
  const pool = (await db.datapoint.findMany({
    where: { organizationId },
    select: {
      id: true,
      metricKey: true,
      subjectType: true,
      subjectId: true,
      reportingPeriod: true,
      valueNumeric: true,
      unit: true,
      provenance: true,
    },
  })) as PoolRow[];

  // --- 1. Trust scores -----------------------------------------------------
  let trustSum = 0;
  let trustChanged = 0;
  for (const dp of scanned) {
    const outcome = await persistTrustScore(db, organizationId, dp, activePeriod, args.actorUserId);
    trustSum += outcome.value;
    if (!outcome.unchanged) trustChanged += 1;
  }
  const avgTrustScore = scanned.length > 0 ? Number((trustSum / scanned.length).toFixed(2)) : null;

  // --- 2. Data-quality issues -------------------------------------------------
  const now = `${periodYear(activePeriod) ?? new Date().getFullYear()}-12-31`;
  const seenIssueKeys = new Set<string>();
  let issuesOpened = 0;

  for (const dp of scanned) {
    const qdp: QualityDatapoint = {
      id: dp.id,
      metricKey: dp.metricKey,
      valueNumeric: dp.valueNumeric ? Number(dp.valueNumeric) : null,
      valueText: dp.valueText,
      unit: dp.unit,
      unitResolves: safeUnitResolves(dp.unit),
      provenance: dp.provenance,
      label: dp.label,
      reportingPeriod: dp.reportingPeriod,
      subjectType: dp.subjectType,
      subjectId: dp.subjectId,
      createdAt: dp.createdAt.toISOString(),
      evidence: dp.evidence.map((link) => ({
        status: link.evidence.status as string,
        expiresAt: link.evidence.expiresAt ? isoDate(link.evidence.expiresAt) : null,
        verified:
          link.evidence.status === 'verified' ||
          link.evidence.verifications.some((v) => /pass|verif|confirm|approv/i.test(v.outcome)),
      })),
      factor: dp.calculation
        ? {
            recognisedSource: isRecognisedSource(dp.calculation.emissionFactor.source),
            validTo: dp.calculation.emissionFactor.validTo
              ? isoDate(dp.calculation.emissionFactor.validTo)
              : null,
            asOf: dp.calculation.activity?.occurredOn
              ? isoDate(dp.calculation.activity.occurredOn)
              : `${periodYear(dp.calculation.reportingPeriod) ?? new Date().getFullYear()}-12-31`,
          }
        : null,
      methodology: dp.calculation?.methodology ?? null,
    };

    const peers: QualityPeer[] = pool
      .filter((p) => p.metricKey === dp.metricKey && p.id !== dp.id)
      .map((p) => ({
        id: p.id,
        metricKey: p.metricKey,
        subjectType: p.subjectType,
        subjectId: p.subjectId,
        reportingPeriod: p.reportingPeriod,
        valueNumeric: p.valueNumeric ? Number(p.valueNumeric) : null,
        unit: p.unit,
        provenance: p.provenance as QualityPeer['provenance'],
      }));

    const findings = evaluateDatapointQuality(qdp, {
      now,
      staleAfterDays: STALE_AFTER_DAYS,
      peers,
    });
    for (const f of findings) {
      const dedupeKey = issueDedupeKey({
        kind: f.kind,
        subjectType: dp.subjectType,
        subjectId: dp.subjectId,
        metricKey: dp.metricKey,
        reportingPeriod: dp.reportingPeriod,
      });
      if (seenIssueKeys.has(dedupeKey)) continue;
      seenIssueKeys.add(dedupeKey);
      const opened = await upsertIssue(db, organizationId, dp.id, dp, f, dedupeKey);
      if (opened) issuesOpened += 1;
    }
  }

  // Auto-resolve issues in this scan's scope that were not re-detected.
  const staleIssues = await db.dataQualityIssue.findMany({
    where: {
      organizationId,
      status: { in: ['open', 'acknowledged'] },
      ...(reportingPeriod ? { reportingPeriod } : {}),
    },
    select: { id: true, dedupeKey: true },
  });
  let issuesResolved = 0;
  for (const it of staleIssues) {
    if (!seenIssueKeys.has(it.dedupeKey)) {
      await db.dataQualityIssue.update({
        where: { id: it.id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionNote: 'No longer detected by the data-quality scan.',
        },
      });
      issuesResolved += 1;
    }
  }

  // --- 3. Anomalies --------------------------------------------------------
  const anomaliesFound = await scanAnomalies(db, organizationId, pool, reportingPeriod);

  // --- 4. Finalise scan --------------------------------------------------------
  const issuesOpen = await db.dataQualityIssue.count({
    where: {
      organizationId,
      status: { in: ['open', 'acknowledged'] },
      ...(reportingPeriod ? { reportingPeriod } : {}),
    },
  });

  await db.qualityScan.update({
    where: { id: scan.id },
    data: {
      datapointsScored: scanned.length,
      avgTrustScore: avgTrustScore != null ? avgTrustScore.toString() : null,
      issuesOpened,
      issuesResolved,
      issuesOpen,
      anomaliesFound,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt,
    },
  });

  await writeAuditLog(db, {
    organizationId,
    actorId: args.actorUserId ?? null,
    action: 'quality.scan_completed',
    resourceType: 'quality_scan',
    resourceId: scan.id,
    before: null,
    after: {
      reportingPeriod: reportingPeriod ?? null,
      datapointsScored: scanned.length,
      avgTrustScore,
      trustChanged,
      issuesOpened,
      issuesResolved,
      issuesOpen,
      anomaliesFound,
    },
    requestId: args.requestId,
  });

  return {
    scanId: scan.id,
    datapointsScored: scanned.length,
    avgTrustScore,
    trustChanged,
    issuesOpened,
    issuesResolved,
    issuesOpen,
    anomaliesFound,
  };
}

/** Returns true when a NEW open issue row was created. */
async function upsertIssue(
  db: TenantDb,
  organizationId: string,
  datapointId: string,
  dp: { metricKey: string; reportingPeriod: string | null; subjectType: string; subjectId: string },
  f: QualityFinding,
  dedupeKey: string,
): Promise<boolean> {
  const existing = await db.dataQualityIssue.findUnique({
    where: { organizationId_dedupeKey: { organizationId, dedupeKey } },
  });

  if (!existing) {
    await db.dataQualityIssue.create({
      data: {
        organizationId,
        kind: f.kind as never,
        severity: f.severity as never,
        subjectType: dp.subjectType,
        subjectId: dp.subjectId,
        datapointId,
        metricKey: dp.metricKey,
        reportingPeriod: dp.reportingPeriod,
        dedupeKey,
        title: f.title,
        detail: f.detail,
        facts: f.facts as Prisma.InputJsonValue,
        rulesVersion: QUALITY_RULES_VERSION,
      },
    });
    return true;
  }

  // Refresh the finding text/severity; reopen an auto-resolved recurrence.
  const reopen = existing.status === 'resolved' && existing.resolutionNote?.startsWith('No longer');
  await db.dataQualityIssue.update({
    where: { id: existing.id },
    data: {
      severity: f.severity as never,
      title: f.title,
      detail: f.detail,
      facts: f.facts as Prisma.InputJsonValue,
      rulesVersion: QUALITY_RULES_VERSION,
      datapointId,
      lastSeenAt: new Date(),
      ...(reopen ? { status: 'open', resolvedAt: null, resolutionNote: null } : {}),
    },
  });
  return false;
}

async function scanAnomalies(
  db: TenantDb,
  organizationId: string,
  pool: PoolRow[],
  reportingPeriod: string | undefined,
): Promise<number> {
  const numeric = pool.filter((p) => p.valueNumeric != null && p.metricKey);
  const seen = new Set<string>();
  const findings: Array<{
    finding: AnomalyFinding;
    subjectType: string;
    subjectId: string;
    metricKey: string;
    reportingPeriod: string | null;
    datapointId: string | null;
  }> = [];

  // (a) Time series: one (subject, metric) across reporting periods.
  const bySubjectMetric = new Map<string, PoolRow[]>();
  for (const p of numeric) {
    const k = `${p.subjectType}::${p.subjectId}::${p.metricKey}`;
    let arr = bySubjectMetric.get(k);
    if (!arr) {
      arr = [];
      bySubjectMetric.set(k, arr);
    }
    arr.push(p);
  }
  for (const rows of bySubjectMetric.values()) {
    const ordered = [...rows]
      .filter((r) => r.reportingPeriod)
      .sort((a, b) => (periodYear(a.reportingPeriod) ?? 0) - (periodYear(b.reportingPeriod) ?? 0));
    if (ordered.length < 2) continue;
    const series: SeriesPoint[] = ordered.map((r) => ({
      key: r.reportingPeriod!,
      value: Number(r.valueNumeric),
      label: r.reportingPeriod!,
    }));
    for (const finding of detectAnomalies(series)) {
      const at = ordered.find((r) => r.reportingPeriod === finding.pointKey) ?? null;
      const first = ordered[0]!;
      findings.push({
        finding,
        subjectType: first.subjectType,
        subjectId: first.subjectId,
        metricKey: first.metricKey,
        reportingPeriod: finding.pointKey,
        datapointId: at?.id ?? null,
      });
    }
  }

  // (b) Cross-section: one metric across subjects within a period (MAD only).
  const byMetricPeriod = new Map<string, PoolRow[]>();
  for (const p of numeric) {
    if (!p.reportingPeriod) continue;
    const k = `${p.metricKey}::${p.reportingPeriod}`;
    let arr = byMetricPeriod.get(k);
    if (!arr) {
      arr = [];
      byMetricPeriod.set(k, arr);
    }
    arr.push(p);
  }
  for (const rows of byMetricPeriod.values()) {
    const distinctSubjects = new Set(rows.map((r) => `${r.subjectType}::${r.subjectId}`));
    if (distinctSubjects.size < 4) continue;
    const series: SeriesPoint[] = rows.map((r) => ({
      key: `${r.subjectType}:${r.subjectId}`,
      value: Number(r.valueNumeric),
    }));
    for (const finding of detectAnomalies(series, {
      relativeChangeThreshold: Number.POSITIVE_INFINITY,
    })) {
      const at = rows.find((r) => `${r.subjectType}:${r.subjectId}` === finding.pointKey);
      if (!at) continue;
      findings.push({
        finding,
        subjectType: at.subjectType,
        subjectId: at.subjectId,
        metricKey: at.metricKey,
        reportingPeriod: at.reportingPeriod,
        datapointId: at.id,
      });
    }
  }

  let created = 0;
  for (const item of findings.slice(0, MAX_ANOMALIES_PER_SCAN)) {
    if (reportingPeriod && item.reportingPeriod && item.reportingPeriod !== reportingPeriod)
      continue;
    const dedupeKey = anomalyDedupeKey({
      method: item.finding.method,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
      metricKey: item.metricKey,
      pointKey: item.finding.pointKey,
    });
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const existing = await db.anomaly.findUnique({
      where: { organizationId_dedupeKey: { organizationId, dedupeKey } },
    });
    if (existing) {
      await db.anomaly.update({
        where: { id: existing.id },
        data: {
          score: item.finding.score.toString(),
          observedValue: item.finding.observedValue.toString(),
          expectedValue: item.finding.expectedValue.toString(),
          explanations: item.finding.explanations as Prisma.InputJsonValue,
          detectorVersion: ANOMALY_DETECTOR_VERSION,
          lastSeenAt: new Date(),
        },
      });
      continue;
    }
    await db.anomaly.create({
      data: {
        organizationId,
        method: item.finding.method as never,
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        datapointId: item.datapointId,
        metricKey: item.metricKey,
        pointKey: item.finding.pointKey,
        reportingPeriod: item.reportingPeriod,
        dedupeKey,
        observedValue: item.finding.observedValue.toString(),
        expectedValue: item.finding.expectedValue.toString(),
        score: item.finding.score.toString(),
        direction: item.finding.direction,
        explanations: item.finding.explanations as Prisma.InputJsonValue,
        detectorVersion: ANOMALY_DETECTOR_VERSION,
      },
    });
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Issue / anomaly triage
// ---------------------------------------------------------------------------

const ISSUE_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
const ANOMALY_STATUSES = ['open', 'explained', 'dismissed'] as const;

export async function updateIssueStatus(
  db: TenantDb,
  args: {
    organizationId: string;
    issueId: string;
    status: IssueStatus;
    note?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string; status: string }> {
  if (!ISSUE_STATUSES.includes(args.status)) {
    throw AppError.unprocessable('issue.bad_status', `Unknown issue status "${args.status}".`);
  }
  const issue = await db.dataQualityIssue.findFirst({
    where: { id: args.issueId, organizationId: args.organizationId },
  });
  if (!issue) throw AppError.notFound('issue.not_found', 'Data-quality issue not found.');

  const closing = args.status === 'resolved' || args.status === 'dismissed';
  const updated = await db.dataQualityIssue.update({
    where: { id: issue.id },
    data: {
      status: args.status as never,
      resolutionNote: args.note ?? (closing ? issue.resolutionNote : null),
      resolvedAt: closing ? new Date() : null,
      resolvedByUserId: closing ? args.actorUserId : null,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'quality.issue_updated',
    resourceType: 'data_quality_issue',
    resourceId: issue.id,
    before: { status: issue.status },
    after: { status: updated.status, note: args.note ?? null },
    requestId: args.requestId,
  });
  return { id: updated.id, status: updated.status };
}

export async function updateAnomalyStatus(
  db: TenantDb,
  args: {
    organizationId: string;
    anomalyId: string;
    status: AnomalyStatus;
    note?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string; status: string }> {
  if (!ANOMALY_STATUSES.includes(args.status)) {
    throw AppError.unprocessable('anomaly.bad_status', `Unknown anomaly status "${args.status}".`);
  }
  const anomaly = await db.anomaly.findFirst({
    where: { id: args.anomalyId, organizationId: args.organizationId },
  });
  if (!anomaly) throw AppError.notFound('anomaly.not_found', 'Anomaly not found.');

  const updated = await db.anomaly.update({
    where: { id: anomaly.id },
    data: {
      status: args.status as never,
      reviewNote: args.note ?? null,
      reviewedByUserId: args.status === 'open' ? null : args.actorUserId,
      reviewedAt: args.status === 'open' ? null : new Date(),
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'quality.anomaly_updated',
    resourceType: 'anomaly',
    resourceId: anomaly.id,
    before: { status: anomaly.status },
    after: { status: updated.status, note: args.note ?? null },
    requestId: args.requestId,
  });
  return { id: updated.id, status: updated.status };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function datapointTrust(
  db: TenantDb,
  organizationId: string,
  datapointId: string,
): Promise<{
  score: {
    id: string;
    value: number;
    band: string;
    modelVersion: string;
    breakdown: unknown;
    computedAt: string;
  } | null;
  issues: Array<Record<string, unknown>>;
  anomalies: Array<Record<string, unknown>>;
}> {
  const score = await db.trustScore.findFirst({
    where: { organizationId, datapointId, supersededBy: { none: {} } },
    orderBy: { computedAt: 'desc' },
  });
  const issues = await db.dataQualityIssue.findMany({
    where: { organizationId, datapointId },
    orderBy: [{ status: 'asc' }, { severity: 'asc' }],
  });
  const anomalies = await db.anomaly.findMany({
    where: { organizationId, datapointId },
    orderBy: { detectedAt: 'desc' },
  });

  return {
    score: score
      ? {
          id: score.id,
          value: score.value,
          band: score.band,
          modelVersion: score.modelVersion,
          breakdown: score.breakdown,
          computedAt: score.computedAt.toISOString(),
        }
      : null,
    issues: issues.map((i) => ({
      id: i.id,
      kind: i.kind,
      severity: i.severity,
      status: i.status,
      title: i.title,
      detail: i.detail,
      facts: i.facts,
      firstDetectedAt: i.firstDetectedAt.toISOString(),
      lastSeenAt: i.lastSeenAt.toISOString(),
    })),
    anomalies: anomalies.map((a) => ({
      id: a.id,
      method: a.method,
      status: a.status,
      pointKey: a.pointKey,
      observedValue: a.observedValue.toString(),
      expectedValue: a.expectedValue.toString(),
      score: a.score.toString(),
      direction: a.direction,
      explanations: a.explanations,
      detectedAt: a.detectedAt.toISOString(),
    })),
  };
}

export interface QualitySummary {
  reportingPeriod: string | null;
  datapoints: number;
  scored: number;
  avgTrustScore: number | null;
  bands: { high: number; medium: number; low: number };
  openIssues: { critical: number; warning: number; info: number; total: number };
  openAnomalies: number;
  lastScan: {
    id: string;
    startedAt: string;
    completedAt: string | null;
    datapointsScored: number;
    avgTrustScore: string | null;
    issuesOpen: number;
    anomaliesFound: number;
  } | null;
}

export async function qualitySummary(
  db: TenantDb,
  organizationId: string,
  reportingPeriod?: string,
): Promise<QualitySummary> {
  const dpWhere = { organizationId, ...(reportingPeriod ? { reportingPeriod } : {}) };
  const datapoints = await db.datapoint.count({ where: dpWhere });

  const scores = await db.trustScore.findMany({
    where: {
      organizationId,
      supersededBy: { none: {} },
      ...(reportingPeriod ? { reportingPeriod } : {}),
    },
    select: { value: true, band: true },
  });
  const bands = { high: 0, medium: 0, low: 0 };
  let sum = 0;
  for (const s of scores) {
    bands[s.band as keyof typeof bands] += 1;
    sum += s.value;
  }
  const avgTrustScore = scores.length > 0 ? Number((sum / scores.length).toFixed(2)) : null;

  const openIssueRows = await db.dataQualityIssue.groupBy({
    by: ['severity'],
    where: {
      organizationId,
      status: { in: ['open', 'acknowledged'] },
      ...(reportingPeriod ? { reportingPeriod } : {}),
    },
    _count: { _all: true },
  });
  const openIssues = { critical: 0, warning: 0, info: 0, total: 0 };
  for (const r of openIssueRows) {
    openIssues[r.severity as keyof Omit<typeof openIssues, 'total'>] = r._count._all;
    openIssues.total += r._count._all;
  }

  const openAnomalies = await db.anomaly.count({
    where: {
      organizationId,
      status: 'open',
      ...(reportingPeriod ? { reportingPeriod } : {}),
    },
  });

  const lastScan = await db.qualityScan.findFirst({
    where: { organizationId, ...(reportingPeriod ? { reportingPeriod } : {}) },
    orderBy: { startedAt: 'desc' },
  });

  return {
    reportingPeriod: reportingPeriod ?? null,
    datapoints,
    scored: scores.length,
    avgTrustScore,
    bands,
    openIssues,
    openAnomalies,
    lastScan: lastScan
      ? {
          id: lastScan.id,
          startedAt: lastScan.startedAt.toISOString(),
          completedAt: lastScan.completedAt ? lastScan.completedAt.toISOString() : null,
          datapointsScored: lastScan.datapointsScored,
          avgTrustScore: lastScan.avgTrustScore ? lastScan.avgTrustScore.toString() : null,
          issuesOpen: lastScan.issuesOpen,
          anomaliesFound: lastScan.anomaliesFound,
        }
      : null,
  };
}
