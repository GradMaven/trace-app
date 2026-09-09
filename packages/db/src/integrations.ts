import {
  getIntegrationAdapter,
  type ColumnMapping,
  type ImportDefaults,
  type ImportPreview,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Enterprise integrations (Phase 12). The `IntegrationAdapter` contract and all
 * parse / map / validate logic live in `@trace/domain` (pure); this module runs
 * the adapter, writes `activity_data` for the valid rows, and records the run.
 * `db` must already be a tenant transaction.
 */

const PREVIEW_ROW_CAP = 200;
const DEFAULT_IMPORT_PROVENANCE = 'estimated';

export interface CommitImportArgs {
  organizationId: string;
  kind: string;
  integrationId?: string;
  fileName: string;
  fileChecksum: string;
  text: string;
  mapping: ColumnMapping;
  defaults: ImportDefaults;
  actorUserId: string;
  requestId: string;
}

export interface CommitImportResult {
  runId: string;
  status: string;
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  rowsImported: number;
  createdActivityIds: string[];
  rowErrors: Array<{ line: number; error: string }>;
}

export function previewImport(
  kind: string,
  text: string,
  mapping: ColumnMapping,
  defaults: ImportDefaults,
): ImportPreview {
  let adapter;
  try {
    adapter = getIntegrationAdapter(kind);
  } catch (err) {
    throw AppError.unprocessable(
      'integration.unknown_kind',
      err instanceof Error ? err.message : 'Unknown integration kind.',
    );
  }
  return adapter.preview({ text, mapping, defaults });
}

export async function commitImport(
  db: TenantDb,
  args: CommitImportArgs,
): Promise<CommitImportResult> {
  const startedAt = Date.now();
  const preview = previewImport(args.kind, args.text, args.mapping, args.defaults);

  const run = await db.integrationRun.create({
    data: {
      organizationId: args.organizationId,
      integrationId: args.integrationId ?? null,
      kind: args.kind,
      status: 'running',
      fileName: args.fileName,
      fileChecksum: args.fileChecksum,
      mapping: args.mapping as unknown as Prisma.InputJsonValue,
      defaults: args.defaults as unknown as Prisma.InputJsonValue,
      rowsTotal: preview.summary.total,
      rowsValid: preview.summary.valid,
      rowsInvalid: preview.summary.invalid,
      preview: preview.rows.slice(0, PREVIEW_ROW_CAP) as unknown as Prisma.InputJsonValue,
      ranByUserId: args.actorUserId,
    },
  });

  const createdActivityIds: string[] = [];
  const rowErrors: Array<{ line: number; error: string }> = [];

  for (const row of preview.rows) {
    if (!row.mapped) continue;
    const m = row.mapped as Record<string, unknown>;
    try {
      const activity = await db.activityData.create({
        data: {
          organizationId: args.organizationId,
          scope: String(m.scope) as never,
          ghgCategory: (m.ghgCategory ? String(m.ghgCategory) : null) as never,
          category: String(m.category),
          description: m.description ? String(m.description) : null,
          value: Number(m.value),
          unit: String(m.unit),
          reportingPeriod: String(m.reportingPeriod),
          provenance: (m.provenance ? String(m.provenance) : DEFAULT_IMPORT_PROVENANCE) as never,
          subjectType: String(m.subjectType),
          subjectId: String(m.subjectId),
          supplierId: m.supplierId ? String(m.supplierId) : null,
          sourceRef: `import:${run.id}:${row.line}`,
          occurredOn: m.occurredOn ? new Date(String(m.occurredOn)) : null,
          createdByUserId: args.actorUserId,
        },
      });
      createdActivityIds.push(activity.id);
    } catch (err) {
      rowErrors.push({
        line: row.line,
        error: err instanceof Error ? err.message.split('\n')[0]! : 'row failed',
      });
    }
  }

  const status =
    createdActivityIds.length === 0 && preview.summary.valid > 0 ? 'failed' : 'completed';
  const updated = await db.integrationRun.update({
    where: { id: run.id },
    data: {
      status,
      rowsImported: createdActivityIds.length,
      createdActivityIds,
      errors: rowErrors as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt,
    },
  });

  if (args.integrationId) {
    await db.integration.updateMany({
      where: { id: args.integrationId, organizationId: args.organizationId },
      data: { lastRunAt: new Date() },
    });
  }

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'integration.import_completed',
    resourceType: 'integration_run',
    resourceId: run.id,
    before: null,
    after: {
      kind: args.kind,
      fileName: args.fileName,
      rowsTotal: preview.summary.total,
      rowsImported: createdActivityIds.length,
      rowsInvalid: preview.summary.invalid,
      status,
    },
    requestId: args.requestId,
  });

  return {
    runId: updated.id,
    status,
    rowsTotal: preview.summary.total,
    rowsValid: preview.summary.valid,
    rowsInvalid: preview.summary.invalid,
    rowsImported: createdActivityIds.length,
    createdActivityIds,
    rowErrors,
  };
}

// ---------------------------------------------------------------------------
// Saved connectors
// ---------------------------------------------------------------------------

export async function createIntegration(
  db: TenantDb,
  args: {
    organizationId: string;
    kind: string;
    name: string;
    config?: Record<string, unknown>;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  try {
    getIntegrationAdapter(args.kind);
  } catch {
    throw AppError.unprocessable(
      'integration.unknown_kind',
      `Unknown integration kind "${args.kind}".`,
    );
  }
  const row = await db.integration.create({
    data: {
      organizationId: args.organizationId,
      kind: args.kind,
      name: args.name,
      config: (args.config ?? {}) as Prisma.InputJsonValue,
      createdByUserId: args.actorUserId,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'integration.created',
    resourceType: 'integration',
    resourceId: row.id,
    before: null,
    after: { kind: args.kind, name: args.name },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function updateIntegration(
  db: TenantDb,
  args: {
    organizationId: string;
    integrationId: string;
    name?: string;
    config?: Record<string, unknown>;
    status?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  const existing = await db.integration.findFirst({
    where: { id: args.integrationId, organizationId: args.organizationId },
  });
  if (!existing) throw AppError.notFound('integration.not_found', 'Integration not found.');
  const row = await db.integration.update({
    where: { id: existing.id },
    data: {
      name: args.name ?? undefined,
      config: args.config ? (args.config as Prisma.InputJsonValue) : undefined,
      status: (args.status ?? undefined) as never,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'integration.updated',
    resourceType: 'integration',
    resourceId: row.id,
    before: { name: existing.name, status: existing.status },
    after: { name: row.name, status: row.status },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function listIntegrations(
  db: TenantDb,
  organizationId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await db.integration.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { runs: true } } },
  });
  return rows.map((i) => ({
    id: i.id,
    kind: i.kind,
    name: i.name,
    config: i.config,
    status: i.status,
    runCount: i._count.runs,
    lastRunAt: i.lastRunAt ? i.lastRunAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  }));
}

function runView(r: {
  id: string;
  integrationId: string | null;
  kind: string;
  status: string;
  fileName: string | null;
  fileChecksum: string | null;
  mapping: unknown;
  defaults: unknown;
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  rowsImported: number;
  preview: unknown;
  errors: unknown;
  createdActivityIds: string[];
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number;
  error: string | null;
}): Record<string, unknown> {
  return {
    id: r.id,
    integrationId: r.integrationId,
    kind: r.kind,
    status: r.status,
    fileName: r.fileName,
    fileChecksum: r.fileChecksum,
    mapping: r.mapping,
    defaults: r.defaults,
    rowsTotal: r.rowsTotal,
    rowsValid: r.rowsValid,
    rowsInvalid: r.rowsInvalid,
    rowsImported: r.rowsImported,
    preview: r.preview,
    errors: r.errors,
    createdActivityIds: r.createdActivityIds,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    durationMs: r.durationMs,
    error: r.error,
  };
}

export async function listIntegrationRuns(
  db: TenantDb,
  organizationId: string,
  limit = 25,
): Promise<Record<string, unknown>[]> {
  const rows = await db.integrationRun.findMany({
    where: { organizationId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
  return rows.map(runView);
}

export async function integrationRunById(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await db.integrationRun.findFirst({ where: { id, organizationId } });
  if (!r) throw AppError.notFound('integration.run_not_found', 'Integration run not found.');
  return runView(r);
}
