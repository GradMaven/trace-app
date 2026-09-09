import { createHash, randomUUID } from 'node:crypto';
import {
  AUDIT_READINESS_MODEL_VERSION,
  assessReadiness,
  canonicalJson,
  type ReadinessAssessment,
  type ReadinessCalculation,
  type ReadinessComplianceGap,
  type ReadinessDatapoint,
  type ReadinessQualityIssue,
} from '@trace/domain';
import {
  AppError,
  type AuditStatus,
  type FindingSeverity,
  type FindingStatus,
} from '@trace/shared';
import { verifyAuditChain, writeAuditLog } from './audit';
import { reproduceCalculation, inventorySummary } from './carbon';
import { complianceGaps } from './compliance';
import { type Prisma, type TenantDb } from './client';

/**
 * Audit workspace (Phase 8). The readiness score and its itemised issues are
 * computed by the pure `assessReadiness` in `@trace/domain`; this module gathers
 * the tenant's evidence, calculations, trust, data-quality, compliance and
 * audit-chain state, persists `audit_simulation_run` + `audit_finding` rows
 * (idempotent re-runs), and assembles the exportable `audit_package` bundle.
 * `db` must already be a tenant transaction.
 */

const DEFAULT_RULE_STORE_VERSION = 'esrs@2026.1';
const DEAD_EVIDENCE = new Set(['rejected', 'superseded']);

function activePeriod(configured: unknown, explicit: string | undefined): string {
  if (explicit) return explicit;
  if (configured && typeof configured === 'object' && 'activePeriod' in configured) {
    const v = (configured as { activePeriod?: unknown }).activePeriod;
    if (typeof v === 'string' && v) return v;
  }
  return `FY${new Date().getFullYear() - 1}`;
}

function periodYear(label: string | null): number | null {
  const m = label?.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function evidenceVerified(status: string, verifications: Array<{ outcome: string }>): boolean {
  return (
    status === 'verified' || verifications.some((v) => /pass|verif|confirm|approv/i.test(v.outcome))
  );
}

// ---------------------------------------------------------------------------
// Readiness simulation
// ---------------------------------------------------------------------------

export interface RunAuditSimulationArgs {
  organizationId: string;
  auditId?: string;
  reportingPeriod?: string;
  ruleStoreVersion?: string;
  actorUserId?: string;
  requestId: string;
}

export interface RunAuditSimulationResult {
  runId: string;
  readiness: ReadinessAssessment;
  findingsOpened: number;
  findingsResolved: number;
  findingsOpen: number;
}

export async function runAuditSimulation(
  db: TenantDb,
  args: RunAuditSimulationArgs,
): Promise<RunAuditSimulationResult> {
  const startedAt = Date.now();
  const org = await db.organization.findUniqueOrThrow({ where: { id: args.organizationId } });
  const reportingPeriod = activePeriod(org.reportingPeriodConfig, args.reportingPeriod);
  const ruleStoreVersion = args.ruleStoreVersion ?? DEFAULT_RULE_STORE_VERSION;
  const now = `${periodYear(reportingPeriod) ?? new Date().getFullYear()}-12-31`;

  const runRow = await db.auditSimulationRun.create({
    data: {
      organizationId: args.organizationId,
      auditId: args.auditId ?? null,
      reportingPeriod,
      ruleStoreVersion,
      readinessValue: 0,
      readinessBand: 'low',
      modelVersion: AUDIT_READINESS_MODEL_VERSION,
      ranByUserId: args.actorUserId ?? null,
    },
  });

  // --- datapoints ------------------------------------------------------
  const datapointRows = await db.datapoint.findMany({
    where: { organizationId: args.organizationId, reportingPeriod },
    include: {
      evidence: { include: { evidence: { include: { verifications: true } } } },
    },
  });
  const trustRows = await db.trustScore.findMany({
    where: {
      organizationId: args.organizationId,
      datapointId: { in: datapointRows.map((d) => d.id) },
      supersededBy: { none: {} },
    },
    select: { datapointId: true, value: true },
  });
  const trustByDp = new Map(trustRows.map((t) => [t.datapointId, t.value]));

  const datapoints: ReadinessDatapoint[] = datapointRows.map((d) => {
    let liveVerified = 0;
    let live = 0;
    let expired = 0;
    for (const link of d.evidence) {
      const ev = link.evidence;
      if (DEAD_EVIDENCE.has(ev.status)) continue;
      const isExpired = ev.expiresAt != null && isoDate(ev.expiresAt) < now;
      if (isExpired) {
        expired += 1;
        continue;
      }
      live += 1;
      if (evidenceVerified(ev.status, ev.verifications)) liveVerified += 1;
    }
    return {
      id: d.id,
      metricKey: d.metricKey,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      hasCalculation: d.calculationId != null,
      liveVerifiedEvidence: liveVerified,
      liveEvidence: live,
      expiredEvidence: expired,
      trustScore: trustByDp.get(d.id) ?? null,
    };
  });

  // --- calculations --------------------------------------------------------
  const calcRows = await db.calculation.findMany({
    where: {
      organizationId: args.organizationId,
      reportingPeriod,
      supersededBy: { none: {} },
    },
    select: { id: true, scope: true, reportingPeriod: true, approvedByUserId: true },
  });
  const calculations: ReadinessCalculation[] = [];
  for (const c of calcRows) {
    const rep = await reproduceCalculation(db, args.organizationId, c.id);
    calculations.push({
      id: c.id,
      scope: c.scope,
      reportingPeriod: c.reportingPeriod,
      reproduced: rep.reproduced,
      approved: c.approvedByUserId != null,
    });
  }

  // --- data-quality issues -----------------------------------------------
  const openIssues = await db.dataQualityIssue.findMany({
    where: { organizationId: args.organizationId, status: { in: ['open', 'acknowledged'] } },
    select: {
      id: true,
      severity: true,
      subjectType: true,
      subjectId: true,
      metricKey: true,
      title: true,
    },
  });
  const openCriticalQualityIssues: ReadinessQualityIssue[] = openIssues
    .filter((i) => i.severity === 'critical')
    .map((i) => ({
      id: i.id,
      subjectType: i.subjectType,
      subjectId: i.subjectId,
      metricKey: i.metricKey,
      title: i.title,
    }));
  const openWarningQualityIssueCount = openIssues.filter((i) => i.severity === 'warning').length;

  // --- compliance --------------------------------------------------------
  const mappingRows = await db.complianceMapping.findMany({
    where: { organizationId: args.organizationId, ruleStoreVersion },
    select: { status: true },
  });
  const complianceRequiredTotal = mappingRows.length;
  const complianceEvidenceOrBetter = mappingRows.filter(
    (m) => m.status === 'evidence_available' || m.status === 'mapping_complete',
  ).length;
  const rawGaps =
    complianceRequiredTotal > 0
      ? ((await complianceGaps(db, args.organizationId, ruleStoreVersion)) as Array<{
          status: string;
          gapReasons: string[];
          requiredDatapoint: { key: string; label: string };
          disclosure: { code: string };
        }>)
      : [];
  const complianceGapsInput: ReadinessComplianceGap[] = rawGaps.map((g) => ({
    requiredDatapointKey: g.requiredDatapoint.key,
    disclosureCode: g.disclosure.code,
    status: g.status,
    title: g.requiredDatapoint.label,
  }));

  // --- audit chain -----------------------------------------------------
  const auditChain = await verifyAuditChain(db, args.organizationId);

  const readiness = assessReadiness({
    reportingPeriod,
    datapoints,
    calculations,
    openCriticalQualityIssues,
    openWarningQualityIssueCount,
    complianceRequiredTotal,
    complianceEvidenceOrBetter,
    complianceGaps: complianceGapsInput,
    auditChain: {
      intact: auditChain.intact,
      count: auditChain.count,
      brokenAt: auditChain.brokenAt,
    },
  });

  // --- persist findings ------------------------------------------------
  const seen = new Set<string>();
  let findingsOpened = 0;
  for (const issue of readiness.issues) {
    const dedupeKey = `sim:${issue.kind}|${issue.subjectType}|${issue.subjectId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const existing = await db.auditFinding.findUnique({
      where: { organizationId_dedupeKey: { organizationId: args.organizationId, dedupeKey } },
    });
    if (!existing) {
      await db.auditFinding.create({
        data: {
          organizationId: args.organizationId,
          auditId: args.auditId ?? null,
          simulationRunId: runRow.id,
          source: 'simulation',
          severity: issue.severity as never,
          kind: issue.kind,
          subjectType: issue.subjectType,
          subjectId: issue.subjectId,
          dedupeKey,
          title: issue.title,
          detail: issue.detail,
        },
      });
      findingsOpened += 1;
    } else {
      const reopen =
        existing.status === 'resolved' && existing.resolutionNote?.startsWith('No longer');
      await db.auditFinding.update({
        where: { id: existing.id },
        data: {
          severity: issue.severity as never,
          kind: issue.kind,
          title: issue.title,
          detail: issue.detail,
          simulationRunId: runRow.id,
          lastSeenAt: new Date(),
          ...(reopen ? { status: 'open', resolvedAt: null, resolutionNote: null } : {}),
        },
      });
    }
  }

  const stale = await db.auditFinding.findMany({
    where: {
      organizationId: args.organizationId,
      source: 'simulation',
      status: { in: ['open', 'acknowledged', 'remediating'] },
    },
    select: { id: true, dedupeKey: true },
  });
  let findingsResolved = 0;
  for (const f of stale) {
    if (!seen.has(f.dedupeKey)) {
      await db.auditFinding.update({
        where: { id: f.id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionNote: 'No longer detected by the readiness simulation.',
        },
      });
      findingsResolved += 1;
    }
  }

  const findingsOpen = await db.auditFinding.count({
    where: {
      organizationId: args.organizationId,
      status: { in: ['open', 'acknowledged', 'remediating'] },
    },
  });

  const issueCounts = readiness.issues.reduce<Record<string, number>>((acc, i) => {
    acc[i.severity] = (acc[i.severity] ?? 0) + 1;
    return acc;
  }, {});

  await db.auditSimulationRun.update({
    where: { id: runRow.id },
    data: {
      readinessValue: readiness.value,
      readinessBand: readiness.band,
      breakdown: readiness.breakdown as unknown as Prisma.InputJsonValue,
      issueCounts: issueCounts as Prisma.InputJsonValue,
      findingsOpened,
      findingsResolved,
      findingsOpen,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId ?? null,
    action: 'audit.simulation_completed',
    resourceType: 'audit_simulation_run',
    resourceId: runRow.id,
    before: null,
    after: {
      reportingPeriod,
      ruleStoreVersion,
      readinessValue: readiness.value,
      readinessBand: readiness.band,
      findingsOpened,
      findingsResolved,
      findingsOpen,
    },
    requestId: args.requestId,
  });

  return { runId: runRow.id, readiness, findingsOpened, findingsResolved, findingsOpen };
}

// ---------------------------------------------------------------------------
// Engagements
// ---------------------------------------------------------------------------

export async function createAudit(
  db: TenantDb,
  args: {
    organizationId: string;
    name: string;
    scope?: string;
    reportingPeriod?: string;
    periodStart?: string;
    periodEnd?: string;
    leadAuditorUserId?: string;
    externalAuditor?: string;
    ruleStoreVersion?: string;
    notes?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  const row = await db.audit.create({
    data: {
      organizationId: args.organizationId,
      name: args.name,
      scope: args.scope ?? '',
      reportingPeriod: args.reportingPeriod ?? null,
      periodStart: args.periodStart ? new Date(args.periodStart) : null,
      periodEnd: args.periodEnd ? new Date(args.periodEnd) : null,
      leadAuditorUserId: args.leadAuditorUserId ?? null,
      externalAuditor: args.externalAuditor ?? null,
      ruleStoreVersion: args.ruleStoreVersion ?? null,
      notes: args.notes ?? null,
      createdByUserId: args.actorUserId,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit.engagement_created',
    resourceType: 'audit',
    resourceId: row.id,
    before: null,
    after: { name: args.name, reportingPeriod: args.reportingPeriod ?? null },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function updateAudit(
  db: TenantDb,
  args: {
    organizationId: string;
    auditId: string;
    status?: AuditStatus;
    name?: string;
    scope?: string;
    externalAuditor?: string;
    notes?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string; status: string }> {
  const existing = await db.audit.findFirst({
    where: { id: args.auditId, organizationId: args.organizationId },
  });
  if (!existing) throw AppError.notFound('audit.not_found', 'Audit engagement not found.');
  const closing = args.status === 'complete';
  const row = await db.audit.update({
    where: { id: existing.id },
    data: {
      status: (args.status ?? undefined) as never,
      name: args.name ?? undefined,
      scope: args.scope ?? undefined,
      externalAuditor: args.externalAuditor ?? undefined,
      notes: args.notes ?? undefined,
      closedAt: closing ? new Date() : existing.closedAt,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit.engagement_updated',
    resourceType: 'audit',
    resourceId: row.id,
    before: { status: existing.status },
    after: { status: row.status },
    requestId: args.requestId,
  });
  return { id: row.id, status: row.status };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export async function createFinding(
  db: TenantDb,
  args: {
    organizationId: string;
    auditId?: string;
    severity: FindingSeverity;
    subjectType: string;
    subjectId: string;
    title: string;
    detail: string;
    recommendation?: string;
    assignedToUserId?: string;
    dueOn?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  const row = await db.auditFinding.create({
    data: {
      organizationId: args.organizationId,
      auditId: args.auditId ?? null,
      source: 'manual',
      severity: args.severity as never,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      dedupeKey: `manual:${randomUUID()}`,
      title: args.title,
      detail: args.detail,
      recommendation: args.recommendation ?? null,
      raisedByUserId: args.actorUserId,
      assignedToUserId: args.assignedToUserId ?? null,
      dueOn: args.dueOn ? new Date(args.dueOn) : null,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit.finding_raised',
    resourceType: 'audit_finding',
    resourceId: row.id,
    before: null,
    after: { severity: args.severity, subjectType: args.subjectType, subjectId: args.subjectId },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function updateFinding(
  db: TenantDb,
  args: {
    organizationId: string;
    findingId: string;
    status?: FindingStatus;
    assignedToUserId?: string | null;
    dueOn?: string | null;
    recommendation?: string;
    note?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string; status: string }> {
  const existing = await db.auditFinding.findFirst({
    where: { id: args.findingId, organizationId: args.organizationId },
  });
  if (!existing) throw AppError.notFound('finding.not_found', 'Audit finding not found.');

  const closing =
    args.status === 'resolved' || args.status === 'accepted_risk' || args.status === 'dismissed';
  const reopening = args.status === 'open' || args.status === 'acknowledged';

  const row = await db.auditFinding.update({
    where: { id: existing.id },
    data: {
      status: (args.status ?? undefined) as never,
      assignedToUserId: args.assignedToUserId === undefined ? undefined : args.assignedToUserId,
      dueOn:
        args.dueOn === undefined ? undefined : args.dueOn === null ? null : new Date(args.dueOn),
      recommendation: args.recommendation ?? undefined,
      resolutionNote: closing
        ? (args.note ?? existing.resolutionNote)
        : reopening
          ? null
          : (args.note ?? existing.resolutionNote),
      resolvedByUserId: closing ? args.actorUserId : reopening ? null : existing.resolvedByUserId,
      resolvedAt: closing ? new Date() : reopening ? null : existing.resolvedAt,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit.finding_updated',
    resourceType: 'audit_finding',
    resourceId: row.id,
    before: { status: existing.status },
    after: { status: row.status, note: args.note ?? null },
    requestId: args.requestId,
  });
  return { id: row.id, status: row.status };
}

// ---------------------------------------------------------------------------
// Audit package
// ---------------------------------------------------------------------------

export interface AuditPackageDeps {
  driver: 'local' | 's3';
  putBytes: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
}

export interface GenerateAuditPackageArgs {
  organizationId: string;
  auditId?: string;
  reportingPeriod?: string;
  ruleStoreVersion?: string;
  actorUserId?: string;
  requestId: string;
}

export interface GenerateAuditPackageResult {
  packageId: string;
  status: string;
  contentDigest: string;
  storageKey: string | null;
  manifest: Record<string, unknown>;
}

export async function generateAuditPackage(
  db: TenantDb,
  deps: AuditPackageDeps,
  args: GenerateAuditPackageArgs,
): Promise<GenerateAuditPackageResult> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: args.organizationId } });
  const reportingPeriod = activePeriod(org.reportingPeriodConfig, args.reportingPeriod);
  const ruleStoreVersion = args.ruleStoreVersion ?? DEFAULT_RULE_STORE_VERSION;

  const pkg = await db.auditPackage.create({
    data: {
      organizationId: args.organizationId,
      auditId: args.auditId ?? null,
      reportingPeriod,
      ruleStoreVersion,
      status: 'generating',
      generatedByUserId: args.actorUserId ?? null,
    },
  });

  try {
    const [
      evidenceRows,
      calcRows,
      datapointRows,
      mappingRows,
      findingRows,
      latestSim,
      chain,
      headRow,
    ] = await Promise.all([
      db.evidence.findMany({
        where: { organizationId: args.organizationId },
        include: { verifications: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.calculation.findMany({
        where: { organizationId: args.organizationId, reportingPeriod, supersededBy: { none: {} } },
        orderBy: { calculatedAt: 'asc' },
      }),
      db.datapoint.findMany({
        where: { organizationId: args.organizationId, reportingPeriod },
        include: { evidence: { select: { evidenceId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.complianceMapping.findMany({
        where: { organizationId: args.organizationId, ruleStoreVersion },
        include: { requiredDatapoint: { select: { key: true, label: true, metricKey: true } } },
      }),
      db.auditFinding.findMany({
        where: {
          organizationId: args.organizationId,
          status: { in: ['open', 'acknowledged', 'remediating'] },
        },
        orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
      }),
      db.auditSimulationRun.findFirst({
        where: { organizationId: args.organizationId },
        orderBy: { startedAt: 'desc' },
      }),
      verifyAuditChain(db, args.organizationId),
      db.auditLog.findFirst({
        where: { organizationId: args.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { hash: true },
      }),
    ]);

    const trustRows = await db.trustScore.findMany({
      where: {
        organizationId: args.organizationId,
        datapointId: { in: datapointRows.map((d) => d.id) },
        supersededBy: { none: {} },
      },
      select: { datapointId: true, value: true, band: true },
    });
    const trustByDp = new Map(trustRows.map((t) => [t.datapointId, t]));

    const reproById = new Map<string, { reproduced: boolean; recomputedResult: string }>();
    for (const c of calcRows) {
      const r = await reproduceCalculation(db, args.organizationId, c.id);
      reproById.set(c.id, { reproduced: r.reproduced, recomputedResult: r.recomputedResult });
    }

    const inventory = await inventorySummary(db, args.organizationId, reportingPeriod);

    const bundle = {
      meta: {
        traceReportPhase: 'phase-8',
        generatedAt: new Date().toISOString(),
        reportingPeriod,
        ruleStoreVersion,
        disclaimer:
          'This audit package is a machine-generated bundle of the organization’s own records and their lineage. It supports professional judgement; it is not an assurance opinion and does not assert compliance.',
      },
      organization: {
        id: org.id,
        legalName: org.legalName,
        country: org.country,
        baseCurrency: org.baseCurrency,
      },
      readiness: latestSim
        ? {
            runId: latestSim.id,
            value: latestSim.readinessValue,
            band: latestSim.readinessBand,
            modelVersion: latestSim.modelVersion,
            breakdown: latestSim.breakdown,
            computedAt: latestSim.startedAt.toISOString(),
          }
        : null,
      inventory,
      evidence: evidenceRows.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        status: e.status,
        reportingPeriod: e.reportingPeriod,
        issuer: e.issuer,
        hash: e.hash,
        documentId: e.documentId,
        version: e.version,
        supersedesId: e.supersedesId,
        createdAt: e.createdAt.toISOString(),
        verifications: e.verifications.map((v) => ({
          method: v.method,
          outcome: v.outcome,
          verifiedAt: v.verifiedAt.toISOString(),
          notes: v.notes,
        })),
      })),
      calculations: calcRows.map((c) => ({
        id: c.id,
        scope: c.scope,
        ghgCategory: c.ghgCategory,
        reportingPeriod: c.reportingPeriod,
        methodology: c.methodology,
        inputValue: c.inputValue.toString(),
        inputUnit: c.inputUnit,
        factorSource: c.factorSource,
        factorVersion: c.factorVersion,
        gwpSet: c.gwpSet,
        resultValueTco2e: c.resultValueTco2e.toString(),
        steps: c.steps,
        factorSelectionReasons: c.factorSelectionReasons,
        calculationVersion: c.calculationVersion,
        approvedByUserId: c.approvedByUserId,
        approvedAt: c.approvedAt ? c.approvedAt.toISOString() : null,
        reproduce: reproById.get(c.id) ?? null,
      })),
      datapoints: datapointRows.map((d) => {
        const t = trustByDp.get(d.id);
        return {
          id: d.id,
          metricKey: d.metricKey,
          value: d.valueNumeric?.toString() ?? d.valueText,
          unit: d.unit,
          provenance: d.provenance,
          label: d.label,
          reportingPeriod: d.reportingPeriod,
          subjectType: d.subjectType,
          subjectId: d.subjectId,
          calculationId: d.calculationId,
          evidenceIds: d.evidence.map((e) => e.evidenceId),
          trust: t ? { value: t.value, band: t.band } : null,
        };
      }),
      compliance: {
        ruleStoreVersion,
        mappings: mappingRows.map((m) => ({
          requiredDatapointKey: m.requiredDatapoint.key,
          label: m.requiredDatapoint.label,
          metricKey: m.requiredDatapoint.metricKey,
          status: m.status,
          gapReasons: m.gapReasons,
          confirmed: m.confirmed,
          resolvedValue: m.resolvedValue ? m.resolvedValue.toString() : null,
          trustScore: m.trustScore,
          datapointIds: m.datapointIds,
          evidenceIds: m.evidenceIds,
        })),
      },
      findings: findingRows.map((f) => ({
        id: f.id,
        source: f.source,
        severity: f.severity,
        kind: f.kind,
        status: f.status,
        subjectType: f.subjectType,
        subjectId: f.subjectId,
        title: f.title,
        detail: f.detail,
      })),
      auditTrail: {
        intact: chain.intact,
        entryCount: chain.count,
        brokenAt: chain.brokenAt,
        headHash: headRow?.hash ?? null,
      },
    };

    const content = canonicalJson(bundle);
    const bytes = Buffer.from(content, 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `audit-packages/${args.organizationId}/${digest}/package.json`;
    await deps.putBytes(storageKey, bytes, 'application/json');

    const manifest = {
      sections: [
        'meta',
        'organization',
        'readiness',
        'inventory',
        'evidence',
        'calculations',
        'datapoints',
        'compliance',
        'findings',
        'auditTrail',
      ],
      evidenceCount: evidenceRows.length,
      calculationCount: calcRows.length,
      reproducedCalculations: [...reproById.values()].filter((r) => r.reproduced).length,
      datapointCount: datapointRows.length,
      complianceMappingCount: mappingRows.length,
      openFindingCount: findingRows.length,
      auditChainIntact: chain.intact,
      readinessValue: latestSim?.readinessValue ?? null,
    };

    const updated = await db.auditPackage.update({
      where: { id: pkg.id },
      data: {
        status: 'ready',
        storageKey,
        storageDriver: deps.driver,
        sizeBytes: bytes.byteLength,
        checksumSha256: digest,
        contentDigest: digest,
        manifest: manifest as Prisma.InputJsonValue,
        readinessValue: latestSim?.readinessValue ?? null,
        generatedAt: new Date(),
      },
    });

    await writeAuditLog(db, {
      organizationId: args.organizationId,
      actorId: args.actorUserId ?? null,
      action: 'audit.package_generated',
      resourceType: 'audit_package',
      resourceId: pkg.id,
      before: null,
      after: { digest, reportingPeriod, sizeBytes: bytes.byteLength, ...manifest },
      requestId: args.requestId,
    });

    return {
      packageId: updated.id,
      status: updated.status,
      contentDigest: digest,
      storageKey,
      manifest,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate the audit package.';
    await db.auditPackage.update({
      where: { id: pkg.id },
      data: { status: 'failed', error: message },
    });
    throw err instanceof AppError
      ? err
      : AppError.internal('audit.package_failed', 'Failed to generate the audit package.');
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function auditReadiness(db: TenantDb, organizationId: string): Promise<unknown> {
  const [latest, findingCounts, packages] = await Promise.all([
    db.auditSimulationRun.findFirst({
      where: { organizationId },
      orderBy: { startedAt: 'desc' },
    }),
    db.auditFinding.groupBy({
      by: ['severity'],
      where: { organizationId, status: { in: ['open', 'acknowledged', 'remediating'] } },
      _count: { _all: true },
    }),
    db.auditPackage.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  const openBySeverity = { critical: 0, warning: 0, info: 0, total: 0 };
  for (const r of findingCounts) {
    openBySeverity[r.severity as keyof Omit<typeof openBySeverity, 'total'>] = r._count._all;
    openBySeverity.total += r._count._all;
  }

  return {
    latestSimulation: latest
      ? {
          id: latest.id,
          reportingPeriod: latest.reportingPeriod,
          ruleStoreVersion: latest.ruleStoreVersion,
          readinessValue: latest.readinessValue,
          readinessBand: latest.readinessBand,
          modelVersion: latest.modelVersion,
          breakdown: latest.breakdown,
          issueCounts: latest.issueCounts,
          startedAt: latest.startedAt.toISOString(),
          completedAt: latest.completedAt ? latest.completedAt.toISOString() : null,
        }
      : null,
    openFindings: openBySeverity,
    packages: packages.map((p) => ({
      id: p.id,
      status: p.status,
      reportingPeriod: p.reportingPeriod,
      contentDigest: p.contentDigest,
      sizeBytes: p.sizeBytes,
      readinessValue: p.readinessValue,
      generatedAt: p.generatedAt ? p.generatedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

/** A per-datapoint audit-readiness view for the evidence-review screen. */
export async function evidenceReviewList(
  db: TenantDb,
  organizationId: string,
  reportingPeriod?: string,
): Promise<unknown[]> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const period = activePeriod(org.reportingPeriodConfig, reportingPeriod);
  const now = `${periodYear(period) ?? new Date().getFullYear()}-12-31`;

  const rows = await db.datapoint.findMany({
    where: { organizationId, reportingPeriod: period },
    include: { evidence: { include: { evidence: { include: { verifications: true } } } } },
    orderBy: [{ metricKey: 'asc' }, { createdAt: 'asc' }],
  });
  const trustRows = await db.trustScore.findMany({
    where: {
      organizationId,
      datapointId: { in: rows.map((r) => r.id) },
      supersededBy: { none: {} },
    },
    select: { datapointId: true, value: true, band: true },
  });
  const trustByDp = new Map(trustRows.map((t) => [t.datapointId, t]));

  const calcIds = [...new Set(rows.map((r) => r.calculationId).filter((x): x is string => !!x))];
  const reproByCalc = new Map<string, boolean>();
  for (const cid of calcIds) {
    const r = await reproduceCalculation(db, organizationId, cid);
    reproByCalc.set(cid, r.reproduced);
  }
  const calcRows = calcIds.length
    ? await db.calculation.findMany({
        where: { id: { in: calcIds } },
        select: { id: true, approvedByUserId: true },
      })
    : [];
  const approvedByCalc = new Map(calcRows.map((c) => [c.id, c.approvedByUserId != null]));

  return rows.map((d) => {
    let verified = 0;
    let live = 0;
    let expired = 0;
    for (const link of d.evidence) {
      const ev = link.evidence;
      if (DEAD_EVIDENCE.has(ev.status)) continue;
      if (ev.expiresAt != null && isoDate(ev.expiresAt) < now) {
        expired += 1;
        continue;
      }
      live += 1;
      if (evidenceVerified(ev.status, ev.verifications)) verified += 1;
    }
    const t = trustByDp.get(d.id);
    return {
      datapointId: d.id,
      metricKey: d.metricKey,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      value: d.valueNumeric?.toString() ?? d.valueText,
      unit: d.unit,
      provenance: d.provenance,
      liveEvidence: live,
      verifiedEvidence: verified,
      expiredEvidence: expired,
      hasCalculation: d.calculationId != null,
      reproduced: d.calculationId ? (reproByCalc.get(d.calculationId) ?? null) : null,
      approved: d.calculationId ? (approvedByCalc.get(d.calculationId) ?? false) : null,
      trustScore: t ? t.value : null,
      trustBand: t ? t.band : null,
    };
  });
}

export async function evidenceChain(
  db: TenantDb,
  organizationId: string,
  datapointId: string,
): Promise<unknown> {
  const dp = await db.datapoint.findFirst({
    where: { id: datapointId, organizationId },
    include: {
      evidence: { include: { evidence: { include: { verifications: true, document: true } } } },
      calculation: { include: { activity: { include: { evidence: true } }, emissionFactor: true } },
    },
  });
  if (!dp) throw AppError.notFound('datapoint.not_found', 'Datapoint not found.');

  const trust = await db.trustScore.findFirst({
    where: { organizationId, datapointId, supersededBy: { none: {} } },
    orderBy: { computedAt: 'desc' },
  });
  const mappings = await db.complianceMapping.findMany({
    where: { organizationId, datapointIds: { has: datapointId } },
    include: {
      requiredDatapoint: { select: { key: true, label: true } },
      disclosure: { select: { code: true } },
    },
  });

  let reproduce = null;
  if (dp.calculationId) {
    reproduce = await reproduceCalculation(db, organizationId, dp.calculationId);
  }

  return {
    datapoint: {
      id: dp.id,
      metricKey: dp.metricKey,
      value: dp.valueNumeric?.toString() ?? dp.valueText,
      unit: dp.unit,
      provenance: dp.provenance,
      label: dp.label,
      reportingPeriod: dp.reportingPeriod,
      subjectType: dp.subjectType,
      subjectId: dp.subjectId,
      createdAt: dp.createdAt.toISOString(),
    },
    trust: trust
      ? {
          value: trust.value,
          band: trust.band,
          modelVersion: trust.modelVersion,
          breakdown: trust.breakdown,
        }
      : null,
    calculation: dp.calculation
      ? {
          id: dp.calculation.id,
          scope: dp.calculation.scope,
          ghgCategory: dp.calculation.ghgCategory,
          methodology: dp.calculation.methodology,
          inputValue: dp.calculation.inputValue.toString(),
          inputUnit: dp.calculation.inputUnit,
          factorValue: dp.calculation.factorValue.toString(),
          factorSource: dp.calculation.factorSource,
          factorVersion: dp.calculation.factorVersion,
          gwpSet: dp.calculation.gwpSet,
          resultValueTco2e: dp.calculation.resultValueTco2e.toString(),
          steps: dp.calculation.steps,
          factorSelectionReasons: dp.calculation.factorSelectionReasons,
          approvedByUserId: dp.calculation.approvedByUserId,
          approvedAt: dp.calculation.approvedAt ? dp.calculation.approvedAt.toISOString() : null,
          reproduce,
          activity: dp.calculation.activity
            ? {
                id: dp.calculation.activity.id,
                category: dp.calculation.activity.category,
                value: dp.calculation.activity.value.toString(),
                unit: dp.calculation.activity.unit,
                provenance: dp.calculation.activity.provenance,
                occurredOn: dp.calculation.activity.occurredOn
                  ? isoDate(dp.calculation.activity.occurredOn)
                  : null,
              }
            : null,
          emissionFactor: {
            id: dp.calculation.emissionFactor.id,
            source: dp.calculation.emissionFactor.source,
            sourceRef: dp.calculation.emissionFactor.sourceRef,
            name: dp.calculation.emissionFactor.name,
            value: dp.calculation.emissionFactor.value.toString(),
            gwpSet: dp.calculation.emissionFactor.gwpSet,
            validFrom: isoDate(dp.calculation.emissionFactor.validFrom),
            validTo: dp.calculation.emissionFactor.validTo
              ? isoDate(dp.calculation.emissionFactor.validTo)
              : null,
          },
        }
      : null,
    evidence: dp.evidence.map((link) => ({
      id: link.evidence.id,
      type: link.evidence.type,
      title: link.evidence.title,
      status: link.evidence.status,
      issuer: link.evidence.issuer,
      reportingPeriod: link.evidence.reportingPeriod,
      hash: link.evidence.hash,
      expiresAt: link.evidence.expiresAt ? isoDate(link.evidence.expiresAt) : null,
      hasDocument: link.evidence.document != null,
      linkedAt: link.linkedAt.toISOString(),
      verifications: link.evidence.verifications.map((v) => ({
        method: v.method,
        outcome: v.outcome,
        verifiedAt: v.verifiedAt.toISOString(),
        notes: v.notes,
      })),
    })),
    complianceMappings: mappings.map((m) => ({
      requiredDatapointKey: m.requiredDatapoint.key,
      label: m.requiredDatapoint.label,
      disclosureCode: m.disclosure.code,
      status: m.status,
      confirmed: m.confirmed,
    })),
  };
}
