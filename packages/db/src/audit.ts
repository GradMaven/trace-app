import {
  appendEntry,
  AUDIT_EXPORT_MAX_ROWS,
  buildWebhookEventPayload,
  GENESIS_HASH,
  normalizeAuditFilter,
  toNdjson,
  verifyChain,
  webhookEventForAuditAction,
  WEBHOOK_MAX_ATTEMPTS,
  type AuditEntryInput,
  type AuditExportRow,
  type AuditQueryFilter,
} from '@trace/domain';
import { Prisma } from '@prisma/client';
import { type TenantDb } from './client';

/**
 * Append-only audit writer (ADR-004).
 *
 * Must be called inside the same transaction as the change it records. Takes a
 * per-scope `FOR UPDATE` lock on `audit_head` so concurrent appends to the same
 * scope serialize and the hash chain stays linear.
 */

export interface WriteAuditInput {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before?: unknown;
  after?: unknown;
  requestId: string;
}

function scopeKey(organizationId: string | null): string {
  return organizationId ?? 'platform';
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export async function writeAuditLog(db: TenantDb, input: WriteAuditInput): Promise<string> {
  const scope = scopeKey(input.organizationId);

  const head = await db.$queryRaw<{ hash: string }[]>`
    SELECT hash FROM audit_head WHERE scope = ${scope} FOR UPDATE
  `;
  const prevHash = head[0]?.hash ?? GENESIS_HASH;

  const createdAt = new Date();
  const entry: AuditEntryInput = {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    before: input.before ?? null,
    after: input.after ?? null,
    requestId: input.requestId,
    createdAt: createdAt.toISOString(),
  };

  const hashed = appendEntry(prevHash, entry);

  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      requestId: entry.requestId,
      createdAt,
      prevHash: hashed.prevHash,
      hash: hashed.hash,
    },
  });

  await db.auditHead.upsert({
    where: { scope },
    create: { scope, hash: hashed.hash },
    update: { hash: hashed.hash },
  });

  await fanOutWebhookDeliveries(db, entry, createdAt);

  return hashed.hash;
}

/**
 * Webhooks mirror the audit stream (Phase 13 / ADR-012). When an action maps to
 * a webhook event and the tenant has active endpoints subscribed to it, queue a
 * `webhook_delivery` per endpoint *in this same transaction* — so a delivery is
 * never queued for a change that rolls back. The worker dispatches them.
 */
async function fanOutWebhookDeliveries(
  db: TenantDb,
  entry: AuditEntryInput,
  occurredAt: Date,
): Promise<void> {
  if (!entry.organizationId) return;
  const event = webhookEventForAuditAction(entry.action);
  if (!event) return;

  const endpoints = await db.webhookEndpoint.findMany({
    where: { organizationId: entry.organizationId, status: 'active', events: { has: event } },
    select: { id: true },
  });
  if (endpoints.length === 0) return;

  for (const endpoint of endpoints) {
    const created = await db.webhookDelivery.create({
      data: {
        organizationId: entry.organizationId,
        endpointId: endpoint.id,
        event,
        status: 'pending',
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
        nextAttemptAt: occurredAt,
        payload: {},
      },
    });
    const payload = buildWebhookEventPayload({
      deliveryId: created.id,
      event,
      organizationId: entry.organizationId,
      occurredAt,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      data: entry.after ?? null,
    });
    await db.webhookDelivery.update({
      where: { id: created.id },
      data: { payload: payload as object },
    });
  }
}

export interface AuditChainRow {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  requestId: string;
  createdAt: Date;
  prevHash: string;
  hash: string;
}

/** Recompute the chain for one scope and report the first break (or -1). */
export async function verifyAuditChain(
  db: TenantDb,
  organizationId: string | null,
): Promise<{ intact: boolean; brokenAt: number; count: number }> {
  const rows = (await db.auditLog.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })) as unknown as AuditChainRow[];

  const result = verifyChain(
    rows.map((r) => ({
      organizationId: r.organizationId,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      before: r.before ?? null,
      after: r.after ?? null,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
      prevHash: r.prevHash,
      hash: r.hash,
    })),
  );

  return { ...result, count: rows.length };
}

// ---------------------------------------------------------------------------
// Audit-log egress (Phase 13c) — filtered query + NDJSON bulk export
// ---------------------------------------------------------------------------

function auditWhere(organizationId: string, filter: AuditQueryFilter): Prisma.AuditLogWhereInput {
  const f = normalizeAuditFilter(filter);
  const where: Prisma.AuditLogWhereInput = { organizationId };
  if (f.actionPrefix) where.action = { startsWith: f.actionPrefix };
  if (f.actorId) where.actorId = f.actorId;
  if (f.resourceType) where.resourceType = f.resourceType;
  if (f.from || f.to) {
    where.createdAt = {};
    if (f.from) where.createdAt.gte = f.from;
    if (f.to) where.createdAt.lt = f.to;
  }
  return where;
}

export interface AuditQueryRow {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  createdAt: string;
  hash: string;
  prevHash: string;
}

/** Filtered, cursor-paged read of the activity log (newest first). */
export async function queryAuditLog(
  db: TenantDb,
  organizationId: string,
  filter: AuditQueryFilter,
  page: { limit: number; cursor?: string },
): Promise<{ data: AuditQueryRow[]; nextCursor?: string }> {
  const rows = await db.auditLog.findMany({
    where: auditWhere(organizationId, filter),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > page.limit;
  const slice = hasMore ? rows.slice(0, page.limit) : rows;
  return {
    data: slice.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
      hash: r.hash,
      prevHash: r.prevHash,
    })),
    ...(hasMore ? { nextCursor: slice[slice.length - 1]!.id } : {}),
  };
}

/**
 * Bulk export of matching entries as newline-delimited JSON (oldest first, so
 * the file is chain-verifiable). Capped at {@link AUDIT_EXPORT_MAX_ROWS}.
 */
export async function exportAuditLog(
  db: TenantDb,
  organizationId: string,
  filter: AuditQueryFilter,
): Promise<{ ndjson: string; rows: number; truncated: boolean }> {
  const rows = await db.auditLog.findMany({
    where: auditWhere(organizationId, filter),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: AUDIT_EXPORT_MAX_ROWS + 1,
  });
  const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;
  const slice = truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows;
  const exportRows: AuditExportRow[] = slice.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    actorId: r.actorId,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    before: r.before ?? null,
    after: r.after ?? null,
    requestId: r.requestId,
    createdAt: r.createdAt.toISOString(),
    prevHash: r.prevHash,
    hash: r.hash,
  }));
  return { ndjson: toNdjson(exportRows), rows: exportRows.length, truncated };
}
