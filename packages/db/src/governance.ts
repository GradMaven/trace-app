import { createHash } from 'node:crypto';
import {
  buildExportManifest,
  canonicalJson,
  EXPORT_SECTIONS,
  EXPORT_TTL_HOURS,
  getRetentionTarget,
  RETENTION_TARGETS,
  retentionCutoff,
  validateRetentionPolicy,
  type ExportManifestSection,
  type ExportSection,
  type RetentionMode,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { Prisma } from '@prisma/client';
import { writeAuditLog } from './audit';
import { type PrismaClient, type TenantDb } from './client';

/**
 * Data governance (Phase 13b): full-tenant export + retention purges.
 *
 * Export mirrors the Phase-8 audit package — read every tenant section, write a
 * canonical-JSON bundle to object storage, expose only metadata + a signed URL.
 * Retention targets are operational / derived data only (see @trace/domain
 * RETENTION_TARGETS); lineage and the audit log are never purged.
 */

// ---------------------------------------------------------------------------
// Full-tenant export
// ---------------------------------------------------------------------------

export interface ExportDeps {
  driver: 'local' | 's3';
  putBytes: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
}

export interface RunExportArgs {
  organizationId: string;
  reportingPeriod?: string | null;
  actorUserId: string;
  requestId: string;
}

export interface RunExportResult {
  id: string;
  status: string;
  totalRecords: number;
  sizeBytes: number;
  sha256: string;
  sectionCounts: Record<string, number>;
  expiresAt: string | null;
}

/** JSON-safe deep copy: Date → ISO, Decimal → string, Buffer → base64. */
function serializeRow(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(serializeRow);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serializeRow(v);
    return out;
  }
  return value;
}

export async function runExport(
  db: TenantDb,
  deps: ExportDeps,
  args: RunExportArgs,
): Promise<RunExportResult> {
  const period = args.reportingPeriod ?? null;

  const job = await db.exportJob.create({
    data: {
      organizationId: args.organizationId,
      status: 'running',
      reportingPeriod: period,
      requestedByUserId: args.actorUserId,
      startedAt: new Date(),
    },
  });

  try {
    const org = args.organizationId;
    const periodWhere = period ? { reportingPeriod: period } : {};

    // Each section: a list of rows already scoped to the tenant.
    const raw: Record<ExportSection, unknown[]> = {
      organization: [await db.organization.findUniqueOrThrow({ where: { id: org } })],
      members: await db.membership.findMany({
        where: { organizationId: org },
        include: {
          user: { select: { email: true, name: true, status: true } },
          roles: { include: { role: { select: { key: true } } } },
        },
      }),
      roles: await db.role.findMany({
        where: { organizationId: org },
        include: { permissions: { select: { permissionKey: true } } },
      }),
      suppliers: await db.supplier.findMany({ where: { organizationId: org } }),
      supplier_relationships: await db.supplierRelationship.findMany({
        where: { organizationId: org },
      }),
      supplier_passports: await db.supplierPassport.findMany({ where: { organizationId: org } }),
      documents: await db.document.findMany({ where: { organizationId: org } }),
      evidence: await db.evidence.findMany({
        where: { organizationId: org },
        include: { verifications: true },
      }),
      datapoints: await db.datapoint.findMany({ where: { organizationId: org, ...periodWhere } }),
      activity_data: await db.activityData.findMany({
        where: { organizationId: org, ...periodWhere },
      }),
      emission_factors: await db.emissionFactor.findMany({ where: { organizationId: org } }),
      calculations: await db.calculation.findMany({
        where: { organizationId: org, ...periodWhere },
      }),
      emissions: await db.emission.findMany({ where: { organizationId: org, ...periodWhere } }),
      trust_scores: await db.trustScore.findMany({ where: { organizationId: org } }),
      data_quality_issues: await db.dataQualityIssue.findMany({ where: { organizationId: org } }),
      anomalies: await db.anomaly.findMany({ where: { organizationId: org } }),
      compliance_mappings: await db.complianceMapping.findMany({ where: { organizationId: org } }),
      disclosure_status: await db.disclosureStatusRecord.findMany({
        where: { organizationId: org },
      }),
      audit_findings: await db.auditFinding.findMany({ where: { organizationId: org } }),
      audit_simulations: await db.auditSimulationRun.findMany({ where: { organizationId: org } }),
      ask_queries: await db.askQuery.findMany({ where: { organizationId: org } }),
      procurement_scenarios: await db.procurementScenario.findMany({
        where: { organizationId: org },
      }),
      integration_runs: await db.integrationRun.findMany({ where: { organizationId: org } }),
      audit_log: await db.auditLog.findMany({
        where: { organizationId: org },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    };

    const sections: Record<string, unknown> = {};
    const counts: ExportManifestSection[] = [];
    for (const key of EXPORT_SECTIONS) {
      const rows = raw[key] ?? [];
      sections[key] = rows.map(serializeRow);
      counts.push({ section: key, count: rows.length });
    }

    const manifest = buildExportManifest({
      organizationId: org,
      generatedAt: new Date(),
      reportingPeriod: period,
      sections: counts,
    });

    const bytes = Buffer.from(canonicalJson({ manifest, sections }), 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `exports/${org}/${sha256}/export.json`;
    await deps.putBytes(storageKey, bytes, 'application/json');

    const sectionCounts = Object.fromEntries(counts.map((c) => [c.section, c.count]));
    const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 3_600_000);

    const updated = await db.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'ready',
        storageKey,
        sha256,
        sizeBytes: bytes.byteLength,
        sectionCounts,
        totalRecords: manifest.totalRecords,
        manifest: manifest as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await writeAuditLog(db, {
      organizationId: org,
      actorId: args.actorUserId,
      action: 'data.exported',
      resourceType: 'export_job',
      resourceId: job.id,
      before: null,
      after: {
        sha256,
        totalRecords: manifest.totalRecords,
        reportingPeriod: period,
        sizeBytes: bytes.byteLength,
      },
      requestId: args.requestId,
    });

    return {
      id: updated.id,
      status: updated.status,
      totalRecords: manifest.totalRecords,
      sizeBytes: bytes.byteLength,
      sha256,
      sectionCounts,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (err) {
    await db.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : 'export failed',
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

export interface ExportJobView {
  id: string;
  status: string;
  reportingPeriod: string | null;
  totalRecords: number;
  sizeBytes: number | null;
  sha256: string | null;
  sectionCounts: unknown;
  requestedByUserId: string;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  error: string | null;
}

function exportView(r: {
  id: string;
  status: string;
  reportingPeriod: string | null;
  totalRecords: number;
  sizeBytes: number | null;
  sha256: string | null;
  sectionCounts: unknown;
  requestedByUserId: string;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
  error: string | null;
}): ExportJobView {
  return {
    id: r.id,
    status: r.status,
    reportingPeriod: r.reportingPeriod,
    totalRecords: r.totalRecords,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    sectionCounts: r.sectionCounts,
    requestedByUserId: r.requestedByUserId,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    error: r.error,
  };
}

export async function listExportJobs(
  db: TenantDb,
  organizationId: string,
): Promise<ExportJobView[]> {
  const rows = await db.exportJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map(exportView);
}

export async function exportJobById(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<ExportJobView & { storageKey: string | null }> {
  const r = await db.exportJob.findFirst({ where: { id, organizationId } });
  if (!r) throw AppError.notFound('export.not_found', 'Export job not found.');
  return { ...exportView(r), storageKey: r.storageKey };
}

/** Mark ready exports whose bundle has passed its TTL as expired (metadata only). */
export async function expireStaleExports(db: TenantDb, organizationId: string): Promise<number> {
  const res = await db.exportJob.updateMany({
    where: { organizationId, status: 'ready', expiresAt: { lt: new Date() } },
    data: { status: 'expired', storageKey: null },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// Retention policies
// ---------------------------------------------------------------------------

export const RETENTION_TARGET_KEYS = RETENTION_TARGETS.map((t) => t.key);

export interface RetentionPolicyView {
  id: string;
  target: string;
  label: string;
  ageDays: number;
  enabled: boolean;
  minAgeDays: number;
  lastRunAt: string | null;
  createdAt: string;
}

export async function upsertRetentionPolicy(
  db: TenantDb,
  args: {
    organizationId: string;
    target: string;
    ageDays: number;
    enabled: boolean;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  const check = validateRetentionPolicy({
    target: args.target,
    ageDays: args.ageDays,
    enabled: args.enabled,
  });
  if (!check.ok) throw AppError.unprocessable('retention.invalid', check.errors.join(' '));

  const existing = await db.retentionPolicy.findUnique({
    where: { organizationId_target: { organizationId: args.organizationId, target: args.target } },
  });
  const row = await db.retentionPolicy.upsert({
    where: { organizationId_target: { organizationId: args.organizationId, target: args.target } },
    create: {
      organizationId: args.organizationId,
      target: args.target,
      ageDays: args.ageDays,
      enabled: args.enabled,
      createdByUserId: args.actorUserId,
    },
    update: { ageDays: args.ageDays, enabled: args.enabled },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'retention.policy_set',
    resourceType: 'retention_policy',
    resourceId: row.id,
    before: existing ? { ageDays: existing.ageDays, enabled: existing.enabled } : null,
    after: { target: args.target, ageDays: args.ageDays, enabled: args.enabled },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function deleteRetentionPolicy(
  db: TenantDb,
  args: { organizationId: string; policyId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.retentionPolicy.findFirst({
    where: { id: args.policyId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('retention.not_found', 'Retention policy not found.');
  await db.retentionPolicy.delete({ where: { id: row.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'retention.policy_deleted',
    resourceType: 'retention_policy',
    resourceId: row.id,
    before: { target: row.target, ageDays: row.ageDays },
    after: null,
    requestId: args.requestId,
  });
}

export async function listRetentionPolicies(
  db: TenantDb,
  organizationId: string,
): Promise<RetentionPolicyView[]> {
  const rows = await db.retentionPolicy.findMany({
    where: { organizationId },
    orderBy: { target: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    label: getRetentionTarget(r.target)?.label ?? r.target,
    ageDays: r.ageDays,
    enabled: r.enabled,
    minAgeDays: getRetentionTarget(r.target)?.min ?? 0,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listRetentionRuns(
  db: TenantDb,
  organizationId: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const rows = await db.retentionRun.findMany({
    where: { organizationId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    label: getRetentionTarget(r.target)?.label ?? r.target,
    mode: r.mode,
    ageDays: r.ageDays,
    cutoff: r.cutoff.toISOString(),
    matched: r.matched,
    deleted: r.deleted,
    ranByUserId: r.ranByUserId,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    error: r.error,
  }));
}

/** count + optional deleteMany for one target, scoped to the tenant. */
async function sweepTarget(
  db: TenantDb,
  organizationId: string,
  target: string,
  cutoff: Date,
  apply: boolean,
): Promise<{ matched: number; deleted: number }> {
  const where = (field: string) => ({ organizationId, [field]: { lt: cutoff } });
  switch (target) {
    case 'ai_job': {
      const w = where('createdAt');
      const matched = await db.aiJob.count({ where: w });
      const deleted = apply ? (await db.aiJob.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    case 'webhook_delivery': {
      const w = where('createdAt');
      const matched = await db.webhookDelivery.count({ where: w });
      const deleted = apply ? (await db.webhookDelivery.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    case 'quality_scan': {
      const w = where('startedAt');
      const matched = await db.qualityScan.count({ where: w });
      const deleted = apply ? (await db.qualityScan.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    case 'audit_simulation_run': {
      const w = where('startedAt');
      const matched = await db.auditSimulationRun.count({ where: w });
      const deleted = apply ? (await db.auditSimulationRun.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    case 'ask_query': {
      const w = where('createdAt');
      const matched = await db.askQuery.count({ where: w });
      const deleted = apply ? (await db.askQuery.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    case 'integration_run': {
      const w = where('startedAt');
      const matched = await db.integrationRun.count({ where: w });
      const deleted = apply ? (await db.integrationRun.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    case 'export_job': {
      const w: Prisma.ExportJobWhereInput = {
        organizationId,
        createdAt: { lt: cutoff },
        status: { in: ['ready', 'failed', 'expired'] },
      };
      const matched = await db.exportJob.count({ where: w });
      const deleted = apply ? (await db.exportJob.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    case 'usage_event': {
      const w = { organizationId, occurredAt: { lt: cutoff } };
      const matched = await db.usageEvent.count({ where: w });
      const deleted = apply ? (await db.usageEvent.deleteMany({ where: w })).count : 0;
      return { matched, deleted };
    }
    default:
      throw AppError.unprocessable(
        'retention.unknown_target',
        `Unknown retention target "${target}".`,
      );
  }
}

export interface RunRetentionArgs {
  organizationId: string;
  /** Restrict to one target; default = every enabled policy. */
  target?: string;
  mode: RetentionMode;
  actorUserId?: string | null;
  requestId: string;
  now?: Date;
}

export interface RetentionRunSummary {
  target: string;
  ageDays: number;
  cutoff: string;
  matched: number;
  deleted: number;
  mode: RetentionMode;
}

export async function runRetention(
  db: TenantDb,
  args: RunRetentionArgs,
): Promise<RetentionRunSummary[]> {
  const now = args.now ?? new Date();

  const org = await db.organization.findUniqueOrThrow({
    where: { id: args.organizationId },
    select: { legalHold: true },
  });
  if (args.mode === 'apply' && org.legalHold) {
    throw AppError.unprocessable(
      'retention.legal_hold',
      'This organization is under legal hold — retention deletion is disabled.',
    );
  }

  const policies = await db.retentionPolicy.findMany({
    where: {
      organizationId: args.organizationId,
      enabled: true,
      ...(args.target ? { target: args.target } : {}),
    },
  });
  if (policies.length === 0) return [];

  const summaries: RetentionRunSummary[] = [];
  for (const policy of policies) {
    const started = Date.now();
    const cutoff = retentionCutoff(policy.ageDays, now);
    let matched = 0;
    let deleted = 0;
    let error: string | null = null;
    try {
      const r = await sweepTarget(
        db,
        args.organizationId,
        policy.target,
        cutoff,
        args.mode === 'apply',
      );
      matched = r.matched;
      deleted = r.deleted;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : 'sweep failed';
    }

    await db.retentionRun.create({
      data: {
        organizationId: args.organizationId,
        policyId: policy.id,
        target: policy.target,
        mode: args.mode,
        ageDays: policy.ageDays,
        cutoff,
        matched,
        deleted,
        ranByUserId: args.actorUserId ?? null,
        completedAt: new Date(),
        durationMs: Date.now() - started,
        error,
      },
    });
    await db.retentionPolicy.update({ where: { id: policy.id }, data: { lastRunAt: new Date() } });

    summaries.push({
      target: policy.target,
      ageDays: policy.ageDays,
      cutoff: cutoff.toISOString(),
      matched,
      deleted,
      mode: args.mode,
    });
  }

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId ?? null,
    action: 'retention.run',
    resourceType: 'organization',
    resourceId: args.organizationId,
    before: null,
    after: {
      mode: args.mode,
      targets: summaries.map((s) => ({ target: s.target, matched: s.matched, deleted: s.deleted })),
    },
    requestId: args.requestId,
  });

  return summaries;
}

/**
 * Active organization ids, for the worker's retention sweep. `retention_policy`
 * is RLS-scoped, so the sweep enumerates orgs from the (repository-scoped)
 * `organization` table and opens `withOrgContext` per org; `runRetention`
 * returns `[]` for an org with no enabled policies.
 */
export async function activeOrganizationIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.organization.findMany({
    where: { status: 'active' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
