import { randomBytes } from 'node:crypto';
import {
  apiKeySecretMatches,
  apiKeyState,
  buildWebhookEventPayload,
  expandApiKeyScopes,
  generateApiKey,
  isRetryableWebhookStatus,
  normalizeApiKeyScopes,
  parseApiKey,
  signWebhookBody,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  webhookNextAttemptAt,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookEvent,
} from '@trace/domain';
import { AppError, type Permission } from '@trace/shared';
import { writeAuditLog } from './audit';
import { withOrgContext, type PrismaClient, type TenantDb } from './client';

/**
 * Enterprise access (Phase 13): API keys + outbound webhooks.
 *
 * `api_key` and `webhook_delivery` are repository-scoped (not RLS'd — see
 * migration 0024): a key is the credential that *establishes* org context, and a
 * delivery is a system log swept cross-tenant by the dispatcher. Every function
 * here still filters by `organizationId` explicitly. `webhook_endpoint` is
 * RLS-forced and only ever touched inside `withOrgContext`.
 */

const LAST_USED_THROTTLE_MS = 60_000;
const WEBHOOK_SECRET_PREFIX = 'whsec_';
const WEBHOOK_AUTO_DISABLE_THRESHOLD = 15;
const RESPONSE_BODY_CAP = 2_000;
const DISPATCH_BATCH = 25;

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export interface CreateApiKeyArgs {
  organizationId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
  actorUserId: string;
  requestId: string;
}

export interface CreateApiKeyResult {
  id: string;
  /** The full `trk_...` token. Returned once; never stored or logged. */
  token: string;
  tokenPrefix: string;
  last4: string;
  scopes: string[];
  permissions: Permission[];
  expiresAt: string | null;
}

export async function createApiKey(
  db: TenantDb,
  args: CreateApiKeyArgs,
): Promise<CreateApiKeyResult> {
  const name = args.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw AppError.unprocessable('apikey.bad_name', 'API key name must be 2–80 characters.');
  }
  const { scopes, rejected } = normalizeApiKeyScopes(args.scopes);
  if (rejected.length > 0) {
    throw AppError.unprocessable('apikey.bad_scope', `Unknown scope(s): ${rejected.join(', ')}.`);
  }
  if (scopes.length === 0) {
    throw AppError.unprocessable('apikey.no_scope', 'An API key needs at least one scope.');
  }
  if (args.expiresAt && args.expiresAt.getTime() <= Date.now()) {
    throw AppError.unprocessable('apikey.bad_expiry', 'Expiry must be in the future.');
  }

  const generated = generateApiKey();
  const row = await db.apiKey.create({
    data: {
      organizationId: args.organizationId,
      name,
      tokenPrefix: generated.keyId,
      hashedSecret: generated.hashedSecret,
      last4: generated.last4,
      scopes,
      createdByUserId: args.actorUserId,
      expiresAt: args.expiresAt ?? null,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'apikey.created',
    resourceType: 'api_key',
    resourceId: row.id,
    before: null,
    after: {
      name,
      scopes,
      tokenPrefix: generated.keyId,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    },
    requestId: args.requestId,
  });

  return {
    id: row.id,
    token: generated.token,
    tokenPrefix: generated.keyId,
    last4: generated.last4,
    scopes,
    permissions: expandApiKeyScopes(scopes),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export async function revokeApiKey(
  db: TenantDb,
  args: { organizationId: string; apiKeyId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.apiKey.findFirst({
    where: { id: args.apiKeyId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('apikey.not_found', 'API key not found.');
  if (row.revokedAt) return;

  await db.apiKey.update({
    where: { id: row.id },
    data: { revokedAt: new Date(), revokedByUserId: args.actorUserId },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'apikey.revoked',
    resourceType: 'api_key',
    resourceId: row.id,
    before: { name: row.name, revokedAt: null },
    after: { name: row.name, revokedAt: new Date().toISOString() },
    requestId: args.requestId,
  });
}

export interface ApiKeyView {
  id: string;
  name: string;
  tokenPrefix: string;
  last4: string;
  scopes: string[];
  permissions: Permission[];
  state: 'active' | 'expired' | 'revoked';
  createdByUserId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export async function listApiKeys(db: TenantDb, organizationId: string): Promise<ApiKeyView[]> {
  const rows = await db.apiKey.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix,
    last4: r.last4,
    scopes: r.scopes,
    permissions: expandApiKeyScopes(r.scopes),
    state: apiKeyState(r),
    createdByUserId: r.createdByUserId,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface AuthenticatedApiKey {
  apiKeyId: string;
  organizationId: string;
  name: string;
  createdByUserId: string;
  permissions: Permission[];
}

/**
 * Resolve a presented `trk_...` token to its organization + effective
 * permissions, or null if it is malformed / unknown / revoked / expired.
 * Global lookup by `token_prefix` (unique) then constant-time secret check.
 */
export async function authenticateApiKey(
  prisma: PrismaClient,
  rawToken: string,
  now: Date = new Date(),
): Promise<AuthenticatedApiKey | null> {
  const parsed = parseApiKey(rawToken);
  if (!parsed) return null;

  const row = await prisma.apiKey.findUnique({ where: { tokenPrefix: parsed.keyId } });
  if (!row) return null;
  if (!apiKeySecretMatches(parsed.secret, row.hashedSecret)) return null;
  if (apiKeyState(row, now) !== 'active') return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: now } })
      .catch(() => undefined);
  }

  return {
    apiKeyId: row.id,
    organizationId: row.organizationId,
    name: row.name,
    createdByUserId: row.createdByUserId,
    permissions: expandApiKeyScopes(row.scopes),
  };
}

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

function newWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(24).toString('base64url')}`;
}

function assertHttpsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw AppError.unprocessable('webhook.bad_url', 'Endpoint URL is not a valid URL.');
  }
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== 'localhost' &&
    parsed.hostname !== '127.0.0.1'
  ) {
    throw AppError.unprocessable('webhook.insecure_url', 'Endpoint URL must use https.');
  }
  return parsed.toString();
}

export interface CreateWebhookEndpointArgs {
  organizationId: string;
  url: string;
  description?: string;
  events: string[];
  actorUserId: string;
  requestId: string;
}

export async function createWebhookEndpoint(
  db: TenantDb,
  args: CreateWebhookEndpointArgs,
): Promise<{ id: string; secret: string }> {
  const url = assertHttpsUrl(args.url);
  const events = dedupeEvents(args.events);
  if (events.length === 0) {
    throw AppError.unprocessable(
      'webhook.no_events',
      'Subscribe the endpoint to at least one event.',
    );
  }
  const secret = newWebhookSecret();
  const row = await db.webhookEndpoint.create({
    data: {
      organizationId: args.organizationId,
      url,
      description: (args.description ?? '').trim(),
      events,
      secret,
      createdByUserId: args.actorUserId,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'webhook.endpoint_created',
    resourceType: 'webhook_endpoint',
    resourceId: row.id,
    before: null,
    after: { url, events },
    requestId: args.requestId,
  });
  return { id: row.id, secret };
}

export interface UpdateWebhookEndpointArgs {
  organizationId: string;
  endpointId: string;
  url?: string;
  description?: string;
  events?: string[];
  status?: 'active' | 'paused';
  actorUserId: string;
  requestId: string;
}

export async function updateWebhookEndpoint(
  db: TenantDb,
  args: UpdateWebhookEndpointArgs,
): Promise<void> {
  const row = await db.webhookEndpoint.findFirst({
    where: { id: args.endpointId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('webhook.not_found', 'Webhook endpoint not found.');

  const nextEvents = args.events ? dedupeEvents(args.events) : undefined;
  if (nextEvents && nextEvents.length === 0) {
    throw AppError.unprocessable(
      'webhook.no_events',
      'Subscribe the endpoint to at least one event.',
    );
  }
  const nextUrl = args.url ? assertHttpsUrl(args.url) : undefined;
  // A manual re-activation clears the failure counter.
  const reactivating = args.status === 'active';

  await db.webhookEndpoint.update({
    where: { id: row.id },
    data: {
      url: nextUrl,
      description: args.description?.trim(),
      events: nextEvents,
      status: args.status,
      consecutiveFailures: reactivating ? 0 : undefined,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'webhook.endpoint_updated',
    resourceType: 'webhook_endpoint',
    resourceId: row.id,
    before: { url: row.url, events: row.events, status: row.status },
    after: {
      url: nextUrl ?? row.url,
      events: nextEvents ?? row.events,
      status: args.status ?? row.status,
    },
    requestId: args.requestId,
  });
}

export async function deleteWebhookEndpoint(
  db: TenantDb,
  args: { organizationId: string; endpointId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.webhookEndpoint.findFirst({
    where: { id: args.endpointId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('webhook.not_found', 'Webhook endpoint not found.');
  await db.webhookEndpoint.delete({ where: { id: row.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'webhook.endpoint_deleted',
    resourceType: 'webhook_endpoint',
    resourceId: row.id,
    before: { url: row.url, events: row.events },
    after: null,
    requestId: args.requestId,
  });
}

export async function rollWebhookSecret(
  db: TenantDb,
  args: { organizationId: string; endpointId: string; actorUserId: string; requestId: string },
): Promise<{ secret: string }> {
  const row = await db.webhookEndpoint.findFirst({
    where: { id: args.endpointId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('webhook.not_found', 'Webhook endpoint not found.');
  const secret = newWebhookSecret();
  await db.webhookEndpoint.update({ where: { id: row.id }, data: { secret } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'webhook.secret_rolled',
    resourceType: 'webhook_endpoint',
    resourceId: row.id,
    before: null,
    after: { url: row.url },
    requestId: args.requestId,
  });
  return { secret };
}

export interface WebhookEndpointView {
  id: string;
  url: string;
  description: string;
  events: string[];
  status: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
}

export async function listWebhookEndpoints(
  db: TenantDb,
  organizationId: string,
): Promise<WebhookEndpointView[]> {
  const rows = await db.webhookEndpoint.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    description: r.description,
    events: r.events,
    status: r.status,
    consecutiveFailures: r.consecutiveFailures,
    lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: r.lastFailureAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Webhook deliveries
// ---------------------------------------------------------------------------

export interface WebhookDeliveryView {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  payload: unknown;
  createdAt: string;
}

function deliveryView(r: {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  payload: unknown;
  createdAt: Date;
}): WebhookDeliveryView {
  return {
    id: r.id,
    endpointId: r.endpointId,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    responseStatus: r.responseStatus,
    responseBody: r.responseBody,
    error: r.error,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listWebhookDeliveries(
  db: TenantDb,
  organizationId: string,
  opts: { endpointId?: string; limit?: number } = {},
): Promise<WebhookDeliveryView[]> {
  const rows = await db.webhookDelivery.findMany({
    where: {
      organizationId,
      ...(opts.endpointId ? { endpointId: opts.endpointId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 200),
  });
  return rows.map(deliveryView);
}

export async function webhookDeliveryById(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<WebhookDeliveryView> {
  const row = await db.webhookDelivery.findFirst({ where: { id, organizationId } });
  if (!row) throw AppError.notFound('webhook.delivery_not_found', 'Delivery not found.');
  return deliveryView(row);
}

export async function retryWebhookDelivery(
  db: TenantDb,
  args: { organizationId: string; deliveryId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.webhookDelivery.findFirst({
    where: { id: args.deliveryId, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('webhook.delivery_not_found', 'Delivery not found.');
  if (row.status !== 'failed' && row.status !== 'dead') {
    throw AppError.unprocessable('webhook.not_retryable', 'Only a failed delivery can be retried.');
  }
  await db.webhookDelivery.update({
    where: { id: row.id },
    data: {
      status: 'pending',
      nextAttemptAt: new Date(),
      maxAttempts: row.attempts + 3,
      error: null,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'webhook.delivery_retried',
    resourceType: 'webhook_delivery',
    resourceId: row.id,
    before: { status: row.status },
    after: { status: 'pending' },
    requestId: args.requestId,
  });
}

/** Queue a synthetic `ping` for an endpoint from its config screen. */
export async function sendTestWebhook(
  db: TenantDb,
  args: { organizationId: string; endpointId: string; actorUserId: string; requestId: string },
): Promise<{ deliveryId: string }> {
  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: args.endpointId, organizationId: args.organizationId },
  });
  if (!endpoint) throw AppError.notFound('webhook.not_found', 'Webhook endpoint not found.');

  const delivery = await db.webhookDelivery.create({
    data: {
      organizationId: args.organizationId,
      endpointId: endpoint.id,
      event: 'ping',
      status: 'pending',
      nextAttemptAt: new Date(),
      payload: {},
    },
  });
  const payload = buildWebhookEventPayload({
    deliveryId: delivery.id,
    event: 'ping',
    organizationId: args.organizationId,
    occurredAt: new Date(),
    resourceType: 'webhook_endpoint',
    resourceId: endpoint.id,
    data: { message: 'This is a test event from TRACE.' },
  });
  await db.webhookDelivery.update({
    where: { id: delivery.id },
    data: { payload: payload as object },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'webhook.test_sent',
    resourceType: 'webhook_endpoint',
    resourceId: endpoint.id,
    before: null,
    after: { deliveryId: delivery.id },
    requestId: args.requestId,
  });
  return { deliveryId: delivery.id };
}

// ---------------------------------------------------------------------------
// Dispatcher (platform sweep — worker + tests + seed)
// ---------------------------------------------------------------------------

export type WebhookFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text: () => Promise<string> }>;

export interface DispatchWebhooksDeps {
  fetch: WebhookFetch;
  now?: Date;
  limit?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface DispatchWebhooksResult {
  attempted: number;
  succeeded: number;
  failed: number;
  dead: number;
}

/**
 * Deliver every due `webhook_delivery` (pending, `nextAttemptAt <= now`). One
 * pass; the worker calls it on an interval. Retries with capped exponential
 * backoff (see @trace/domain); a delivery that exhausts `maxAttempts` is `dead`.
 * An endpoint that fails {@link WEBHOOK_AUTO_DISABLE_THRESHOLD} times in a row is
 * auto-`disabled`.
 */
export async function dispatchDueWebhookDeliveries(
  prisma: PrismaClient,
  deps: DispatchWebhooksDeps,
): Promise<DispatchWebhooksResult> {
  const now = deps.now ?? new Date();
  const limit = deps.limit ?? DISPATCH_BATCH;
  const result: DispatchWebhooksResult = { attempted: 0, succeeded: 0, failed: 0, dead: 0 };

  // `webhook_delivery` is repository-scoped (no RLS); read the due batch directly.
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  for (const delivery of due) {
    result.attempted += 1;
    const attempt = delivery.attempts + 1;
    const body = JSON.stringify(delivery.payload);
    const ts = Math.floor(now.getTime() / 1000);

    // `webhook_endpoint` is RLS-protected (FORCE). This runs outside any tenant
    // context, so every read/write of it goes through the delivery's own org.
    const endpoint = await withOrgContext(
      delivery.organizationId,
      (db) => db.webhookEndpoint.findUnique({ where: { id: delivery.endpointId } }),
      prisma,
    );
    if (!endpoint || endpoint.status === 'disabled') {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed',
          error: endpoint ? 'endpoint disabled' : 'endpoint missing',
          nextAttemptAt: null,
        },
      });
      result.failed += 1;
      continue;
    }

    let status = 0;
    let responseBody = '';
    let error: string | null = null;
    try {
      const res = await deps.fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': deps.userAgent ?? 'TRACE-Webhooks/1.0',
          [WEBHOOK_EVENT_HEADER]: delivery.event,
          [WEBHOOK_DELIVERY_HEADER]: delivery.id,
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(endpoint.secret, ts, body),
        },
        body,
      });
      status = res.status;
      responseBody = (await res.text().catch(() => '')).slice(0, RESPONSE_BODY_CAP);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, RESPONSE_BODY_CAP) : 'request failed';
    }

    const ok = status >= 200 && status < 300;
    const canRetry =
      attempt < delivery.maxAttempts && (error !== null || isRetryableWebhookStatus(status));
    const nextStatus: 'succeeded' | 'pending' | 'failed' | 'dead' = ok
      ? 'succeeded'
      : canRetry
        ? 'pending'
        : attempt >= delivery.maxAttempts
          ? 'dead'
          : 'failed';

    // Persist the delivery outcome and the endpoint health together, in a short
    // transaction scoped to the delivery's org (no external I/O inside it).
    await withOrgContext(
      delivery.organizationId,
      async (db) => {
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: nextStatus,
            attempts: attempt,
            lastAttemptAt: now,
            nextAttemptAt:
              nextStatus === 'pending' ? webhookNextAttemptAt(attempt + 1, now) : null,
            responseStatus: status || null,
            responseBody: responseBody || null,
            error,
          },
        });

        if (ok) {
          await db.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { lastSuccessAt: now, consecutiveFailures: 0 },
          });
        } else {
          const failures = endpoint.consecutiveFailures + 1;
          await db.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: {
              lastFailureAt: now,
              consecutiveFailures: failures,
              status:
                failures >= WEBHOOK_AUTO_DISABLE_THRESHOLD && endpoint.status === 'active'
                  ? 'disabled'
                  : undefined,
            },
          });
        }
      },
      prisma,
    );

    if (ok) result.succeeded += 1;
    else if (nextStatus === 'dead') result.dead += 1;
    else result.failed += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function dedupeEvents(events: string[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const t = e.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export type { WebhookEvent };
