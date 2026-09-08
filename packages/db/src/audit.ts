import { appendEntry, GENESIS_HASH, verifyChain, type AuditEntryInput } from '@trace/domain';
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

  return hashed.hash;
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
