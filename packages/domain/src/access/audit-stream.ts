/**
 * Audit-log streaming (Phase 13d) — pure. An audit stream is a per-organization
 * subscription that pushes **every** matching audit entry (not just the curated
 * webhook events) to a SIEM endpoint, cursor-tailed by the worker and signed
 * like a webhook.
 */

export interface AuditStreamFilter {
  /** Match when the action starts with any of these (empty = match every action). */
  actionPrefixes?: string[];
  /** Restrict to these resource types (empty = any). */
  resourceTypes?: string[];
}

const PREFIX_RE = /^[a-z][a-z0-9_.]{0,60}$/;
const RESOURCE_RE = /^[a-z][a-z0-9_]{0,60}$/;

export function normalizeAuditStreamFilter(input: AuditStreamFilter): AuditStreamFilter {
  const actionPrefixes = (input.actionPrefixes ?? [])
    .map((s) => s.trim())
    .filter((s) => PREFIX_RE.test(s));
  const resourceTypes = (input.resourceTypes ?? [])
    .map((s) => s.trim())
    .filter((s) => RESOURCE_RE.test(s));
  const out: AuditStreamFilter = {};
  if (actionPrefixes.length) out.actionPrefixes = [...new Set(actionPrefixes)];
  if (resourceTypes.length) out.resourceTypes = [...new Set(resourceTypes)];
  return out;
}

export function matchesAuditStream(
  filter: AuditStreamFilter,
  entry: { action: string; resourceType: string },
): boolean {
  const prefixes = filter.actionPrefixes ?? [];
  const resources = filter.resourceTypes ?? [];
  const actionOk = prefixes.length === 0 || prefixes.some((p) => entry.action.startsWith(p));
  const resourceOk = resources.length === 0 || resources.includes(entry.resourceType);
  return actionOk && resourceOk;
}

// ---------------------------------------------------------------------------
// Batch envelope + retry schedule
// ---------------------------------------------------------------------------

export const AUDIT_STREAM_BATCH_SIZE = 200;
export const AUDIT_STREAM_MAX_ATTEMPTS = 8;
/** Auto-pause a stream after this many consecutive failed deliveries. */
export const AUDIT_STREAM_AUTO_PAUSE_THRESHOLD = 20;
export const AUDIT_STREAM_SIGNATURE_HEADER = 'x-trace-signature';
export const AUDIT_STREAM_EVENT_HEADER = 'x-trace-stream';

const BACKOFF_SECONDS = [0, 15, 60, 300, 900, 3600, 10800, 21600];

export function auditStreamNextAttemptAt(nextAttempt: number, from: Date = new Date()): Date {
  const idx = Math.min(Math.max(nextAttempt - 1, 0), BACKOFF_SECONDS.length - 1);
  return new Date(from.getTime() + BACKOFF_SECONDS[idx]! * 1000);
}

export interface AuditStreamEntry {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export interface AuditStreamBatch {
  stream: 'audit-log';
  streamId: string;
  organizationId: string;
  deliveryId: string;
  sentAt: string;
  count: number;
  entries: AuditStreamEntry[];
}

export function buildAuditStreamBatch(input: {
  streamId: string;
  organizationId: string;
  deliveryId: string;
  sentAt: Date;
  entries: AuditStreamEntry[];
}): AuditStreamBatch {
  return {
    stream: 'audit-log',
    streamId: input.streamId,
    organizationId: input.organizationId,
    deliveryId: input.deliveryId,
    sentAt: input.sentAt.toISOString(),
    count: input.entries.length,
    entries: input.entries,
  };
}
