import { randomBytes } from 'node:crypto';
import {
  AUDIT_STREAM_AUTO_PAUSE_THRESHOLD,
  AUDIT_STREAM_BATCH_SIZE,
  AUDIT_STREAM_EVENT_HEADER,
  AUDIT_STREAM_MAX_ATTEMPTS,
  AUDIT_STREAM_SIGNATURE_HEADER,
  auditStreamNextAttemptAt,
  buildAuditStreamBatch,
  isRetryableWebhookStatus,
  matchesAuditStream,
  normalizeAuditStreamFilter,
  signWebhookBody,
  type AuditStreamEntry,
  type AuditStreamFilter,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { type Prisma, type PrismaClient, type TenantDb } from './client';
import { writeAuditLog } from './audit';
import { type WebhookFetch } from './access';

/**
 * Audit-log streaming (Phase 13d). The worker calls `dispatchOrgAuditStreams`
 * inside `withOrgContext` per org: for each active `audit_stream` it retries any
 * in-flight delivery, else reads the next window of `audit_log` after the
 * stream's cursor, and POSTs a signed batch of the matching entries.
 * `audit_stream` is RLS-forced; `audit_stream_delivery` carries `organization_id`
 * and every read filters on it.
 */

const SECRET_PREFIX = 'strm_';
const RESPONSE_ERR_CAP = 500;
const TEST_CURSOR = '__test__';

function newSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(24).toString('base64url')}`;
}

function assertHttpsUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw AppError.unprocessable('audit_stream.bad_url', 'Stream URL is not a valid URL.');
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw AppError.unprocessable('audit_stream.insecure_url', 'Stream URL must use https.');
  }
  return u.toString();
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateAuditStreamArgs {
  organizationId: string;
  name: string;
  url: string;
  filters?: AuditStreamFilter;
  actorUserId: string;
  requestId: string;
}

export async function createAuditStream(
  db: TenantDb,
  args: CreateAuditStreamArgs,
): Promise<{ id: string; secret: string }> {
  const url = assertHttpsUrl(args.url);
  const name = args.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw AppError.unprocessable('audit_stream.bad_name', 'Stream name must be 2–80 characters.');
  }
  const filters = normalizeAuditStreamFilter(args.filters ?? {});
  // Start at the current log head — history is not back-filled.
  const head = await db.auditLog.findFirst({
    where: { organizationId: args.organizationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  const secret = newSecret();
  const row = await db.auditStream.create({
    data: {
      organizationId: args.organizationId,
      name,
      url,
      secret,
      filters: filters as unknown as Prisma.InputJsonValue,
      cursor: head?.id ?? null,
      createdByUserId: args.actorUserId,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit_stream.created',
    resourceType: 'audit_stream',
    resourceId: row.id,
    before: null,
    after: { url, filters },
    requestId: args.requestId,
  });
  return { id: row.id, secret };
}

export interface UpdateAuditStreamArgs {
  organizationId: string;
  streamId: string;
  name?: string;
  url?: string;
  filters?: AuditStreamFilter;
  status?: 'active' | 'paused';
  actorUserId: string;
  requestId: string;
}

export async function updateAuditStream(db: TenantDb, args: UpdateAuditStreamArgs): Promise<void> {
  const row = await db.auditStream.findFirst({
    where: { id: args.streamId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('audit_stream.not_found', 'Audit stream not found.');

  const nextUrl = args.url ? assertHttpsUrl(args.url) : undefined;
  const nextFilters = args.filters ? normalizeAuditStreamFilter(args.filters) : undefined;
  const reactivating = args.status === 'active';

  await db.auditStream.update({
    where: { id: row.id },
    data: {
      name: args.name?.trim(),
      url: nextUrl,
      filters: nextFilters ? (nextFilters as unknown as Prisma.InputJsonValue) : undefined,
      status: args.status,
      consecutiveFailures: reactivating ? 0 : undefined,
      lastError: reactivating ? null : undefined,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit_stream.updated',
    resourceType: 'audit_stream',
    resourceId: row.id,
    before: { url: row.url, status: row.status, filters: row.filters },
    after: {
      url: nextUrl ?? row.url,
      status: args.status ?? row.status,
      filters: nextFilters ?? row.filters,
    },
    requestId: args.requestId,
  });
}

export async function deleteAuditStream(
  db: TenantDb,
  args: { organizationId: string; streamId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.auditStream.findFirst({
    where: { id: args.streamId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('audit_stream.not_found', 'Audit stream not found.');
  await db.auditStream.delete({ where: { id: row.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit_stream.deleted',
    resourceType: 'audit_stream',
    resourceId: row.id,
    before: { url: row.url },
    after: null,
    requestId: args.requestId,
  });
}

export async function rotateAuditStreamSecret(
  db: TenantDb,
  args: { organizationId: string; streamId: string; actorUserId: string; requestId: string },
): Promise<{ secret: string }> {
  const row = await db.auditStream.findFirst({
    where: { id: args.streamId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('audit_stream.not_found', 'Audit stream not found.');
  const secret = newSecret();
  await db.auditStream.update({ where: { id: row.id }, data: { secret } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit_stream.secret_rotated',
    resourceType: 'audit_stream',
    resourceId: row.id,
    before: null,
    after: { url: row.url },
    requestId: args.requestId,
  });
  return { secret };
}

export interface AuditStreamView {
  id: string;
  name: string;
  url: string;
  filters: unknown;
  status: string;
  cursor: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export async function listAuditStreams(
  db: TenantDb,
  organizationId: string,
): Promise<AuditStreamView[]> {
  const rows = await db.auditStream.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    filters: r.filters,
    status: r.status,
    cursor: r.cursor,
    consecutiveFailures: r.consecutiveFailures,
    lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface AuditStreamDeliveryView {
  id: string;
  streamId: string;
  count: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  fromCursor: string | null;
  toCursor: string;
  responseStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
}

export async function listAuditStreamDeliveries(
  db: TenantDb,
  organizationId: string,
  opts: { streamId?: string; limit?: number } = {},
): Promise<AuditStreamDeliveryView[]> {
  const rows = await db.auditStreamDelivery.findMany({
    where: { organizationId, ...(opts.streamId ? { streamId: opts.streamId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 200),
  });
  return rows.map((r) => ({
    id: r.id,
    streamId: r.streamId,
    count: r.count,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    fromCursor: r.fromCursor,
    toCursor: r.toCursor,
    responseStatus: r.responseStatus,
    error: r.error,
    nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function sendTestAuditStream(
  db: TenantDb,
  args: { organizationId: string; streamId: string; actorUserId: string; requestId: string },
): Promise<{ deliveryId: string }> {
  const stream = await db.auditStream.findFirst({
    where: { id: args.streamId, organizationId: args.organizationId },
  });
  if (!stream) throw AppError.notFound('audit_stream.not_found', 'Audit stream not found.');
  const delivery = await db.auditStreamDelivery.create({
    data: {
      organizationId: args.organizationId,
      streamId: stream.id,
      fromCursor: TEST_CURSOR,
      toCursor: TEST_CURSOR,
      count: 1,
      status: 'pending',
      nextAttemptAt: new Date(),
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'audit_stream.test_sent',
    resourceType: 'audit_stream',
    resourceId: stream.id,
    before: null,
    after: { deliveryId: delivery.id },
    requestId: args.requestId,
  });
  return { deliveryId: delivery.id };
}

// ---------------------------------------------------------------------------
// Dispatch (per-org, called from the worker inside withOrgContext)
// ---------------------------------------------------------------------------

export interface DispatchAuditStreamsDeps {
  fetch: WebhookFetch;
  now?: Date;
  batchSize?: number;
  userAgent?: string;
}

export interface DispatchAuditStreamsResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

function toStreamEntry(r: {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  createdAt: Date;
  prevHash: string;
  hash: string;
}): AuditStreamEntry {
  return {
    id: r.id,
    organizationId: r.organizationId,
    actorId: r.actorId,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    requestId: r.requestId,
    createdAt: r.createdAt.toISOString(),
    prevHash: r.prevHash,
    hash: r.hash,
  };
}

async function postBatch(
  deps: DispatchAuditStreamsDeps,
  url: string,
  secret: string,
  streamId: string,
  body: string,
  now: Date,
): Promise<{ status: number; error: string | null }> {
  const ts = Math.floor(now.getTime() / 1000);
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': deps.userAgent ?? 'TRACE-AuditStream/1.0',
        [AUDIT_STREAM_EVENT_HEADER]: streamId,
        [AUDIT_STREAM_SIGNATURE_HEADER]: signWebhookBody(secret, ts, body),
      },
      body,
    });
    const text = (await res.text().catch(() => '')).slice(0, RESPONSE_ERR_CAP);
    return {
      status: res.status,
      error: res.status >= 200 && res.status < 300 ? null : text || `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      status: 0,
      error: err instanceof Error ? err.message.slice(0, RESPONSE_ERR_CAP) : 'request failed',
    };
  }
}

export async function dispatchOrgAuditStreams(
  db: TenantDb,
  deps: DispatchAuditStreamsDeps,
): Promise<DispatchAuditStreamsResult> {
  const now = deps.now ?? new Date();
  const batchSize = deps.batchSize ?? AUDIT_STREAM_BATCH_SIZE;
  const result: DispatchAuditStreamsResult = { attempted: 0, succeeded: 0, failed: 0 };

  const streams = await db.auditStream.findMany({ where: { status: 'active' } });

  for (const stream of streams) {
    // 1. Retry an in-flight delivery, if any is due.
    const pending = await db.auditStreamDelivery.findFirst({
      where: {
        streamId: stream.id,
        status: { in: ['pending', 'failed'] },
        nextAttemptAt: { lte: now },
      },
      orderBy: { createdAt: 'asc' },
    });

    let deliveryId: string;
    let fromCursor: string | null;
    let toCursor: string;
    let entries: AuditStreamEntry[];
    let isTest = false;

    if (pending) {
      deliveryId = pending.id;
      fromCursor = pending.fromCursor;
      toCursor = pending.toCursor;
      isTest = pending.fromCursor === TEST_CURSOR;
      entries = isTest
        ? []
        : await readWindow(
            db,
            stream.organizationId,
            pending.fromCursor,
            batchSize,
            stream.filters,
          );
    } else {
      const rows = await db.auditLog.findMany({
        where: { organizationId: stream.organizationId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        ...(stream.cursor ? { cursor: { id: stream.cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) continue;
      const lastId = rows[rows.length - 1]!.id;
      const matching = rows
        .filter((r) => matchesAuditStream(stream.filters as AuditStreamFilter, r))
        .map(toStreamEntry);
      if (matching.length === 0) {
        // Nothing to send — still make progress through the log.
        await db.auditStream.update({ where: { id: stream.id }, data: { cursor: lastId } });
        continue;
      }
      const created = await db.auditStreamDelivery.create({
        data: {
          organizationId: stream.organizationId,
          streamId: stream.id,
          fromCursor: stream.cursor,
          toCursor: lastId,
          count: matching.length,
          status: 'pending',
        },
      });
      deliveryId = created.id;
      fromCursor = stream.cursor;
      toCursor = lastId;
      entries = matching;
    }

    result.attempted += 1;
    const attempt = (pending?.attempts ?? 0) + 1;
    const batch = isTest
      ? buildAuditStreamBatch({
          streamId: stream.id,
          organizationId: stream.organizationId,
          deliveryId,
          sentAt: now,
          entries: [
            {
              id: 'test',
              organizationId: stream.organizationId,
              actorId: null,
              action: 'audit_stream.ping',
              resourceType: 'audit_stream',
              resourceId: stream.id,
              requestId: 'test',
              createdAt: now.toISOString(),
              prevHash: '',
              hash: '',
            },
          ],
        })
      : buildAuditStreamBatch({
          streamId: stream.id,
          organizationId: stream.organizationId,
          deliveryId,
          sentAt: now,
          entries,
        });

    const { status, error } = await postBatch(
      deps,
      stream.url,
      stream.secret,
      stream.id,
      JSON.stringify(batch),
      now,
    );
    const ok = status >= 200 && status < 300;
    const canRetry =
      attempt < AUDIT_STREAM_MAX_ATTEMPTS && (status === 0 || isRetryableWebhookStatus(status));

    if (ok) {
      result.succeeded += 1;
      await db.auditStreamDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'succeeded',
          attempts: attempt,
          lastAttemptAt: now,
          nextAttemptAt: null,
          responseStatus: status,
          error: null,
        },
      });
      await db.auditStream.update({
        where: { id: stream.id },
        data: {
          ...(isTest ? {} : { cursor: toCursor }),
          consecutiveFailures: 0,
          lastError: null,
          lastDeliveryAt: now,
        },
      });
    } else {
      result.failed += 1;
      const dead = !canRetry;
      await db.auditStreamDelivery.update({
        where: { id: deliveryId },
        data: {
          status: dead ? 'dead' : 'failed',
          attempts: attempt,
          lastAttemptAt: now,
          nextAttemptAt: dead ? null : auditStreamNextAttemptAt(attempt + 1, now),
          responseStatus: status || null,
          error,
        },
      });
      const failures = stream.consecutiveFailures + 1;
      await db.auditStream.update({
        where: { id: stream.id },
        data: {
          consecutiveFailures: failures,
          lastError: error,
          // A dead delivery would otherwise wedge the stream forever: skip past it.
          ...(dead && !isTest ? { cursor: toCursor } : {}),
          ...(failures >= AUDIT_STREAM_AUTO_PAUSE_THRESHOLD ? { status: 'paused' as const } : {}),
        },
      });
    }
    void fromCursor;
  }

  return result;
}

async function readWindow(
  db: TenantDb,
  organizationId: string,
  fromCursor: string | null,
  batchSize: number,
  filters: unknown,
): Promise<AuditStreamEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
    ...(fromCursor && fromCursor !== TEST_CURSOR ? { cursor: { id: fromCursor }, skip: 1 } : {}),
  });
  return rows.filter((r) => matchesAuditStream(filters as AuditStreamFilter, r)).map(toStreamEntry);
}

// ---------------------------------------------------------------------------
// Component heartbeat (monitoring)
// ---------------------------------------------------------------------------

export async function writeHeartbeat(
  prisma: PrismaClient,
  component: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const beatAt = new Date();
  await prisma.componentHeartbeat
    .upsert({
      where: { component },
      create: { component, beatAt, meta: meta as Prisma.InputJsonValue },
      update: { beatAt, meta: meta as Prisma.InputJsonValue },
    })
    .catch(() => undefined);
}

export async function readHeartbeat(
  prisma: PrismaClient,
  component: string,
): Promise<{ beatAt: Date; meta: unknown } | null> {
  const row = await prisma.componentHeartbeat.findUnique({ where: { component } });
  return row ? { beatAt: row.beatAt, meta: row.meta } : null;
}
