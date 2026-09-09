import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Outbound webhooks (Phase 13).
 *
 * A webhook mirrors the audit stream: when a consequential mutation writes an
 * audit entry whose action maps to a {@link WebhookEvent}, a delivery is queued
 * for every active endpoint subscribed to that event. This module is the pure
 * part — the event vocabulary, the audit-action → event mapping, HMAC signing,
 * and the retry schedule. All I/O (queuing rows, POSTing) is in `@trace/db` and
 * the worker.
 */

export const WEBHOOK_EVENTS = {
  ping: 'Test event sent from the endpoint configuration screen',
  'evidence.verified': 'A piece of evidence was marked verified',
  'evidence.rejected': 'A piece of evidence was rejected',
  'calculation.completed': 'An emission calculation was run',
  'calculation.approved': 'A calculation result was approved',
  'trust.scan_completed': 'A Trust Score / data-quality scan finished',
  'compliance.evaluated': 'A compliance evaluation run finished',
  'audit.simulation_completed': 'An audit-readiness simulation finished',
  'audit.finding_raised': 'An audit finding was raised',
  'audit.package_generated': 'An audit package was generated',
  'integration.import_completed': 'An activity-data import finished',
  'document.extraction_completed': 'AI extraction finished for a document',
  'supplier.request_submitted': 'A supplier submitted an information request',
  'supplier.passport_recomputed': 'A Supplier Passport was recomputed',
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

export const WEBHOOK_EVENT_NAMES = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];

/** Events a user may subscribe an endpoint to (everything except the synthetic `ping`). */
export const SUBSCRIBABLE_WEBHOOK_EVENTS = WEBHOOK_EVENT_NAMES.filter((e) => e !== 'ping');

export function isWebhookEvent(value: string): value is WebhookEvent {
  return value in WEBHOOK_EVENTS;
}

const AUDIT_ACTION_TO_EVENT: Record<string, WebhookEvent> = {
  'evidence.transitioned.verified': 'evidence.verified',
  'evidence.transitioned.rejected': 'evidence.rejected',
  'calculation.run': 'calculation.completed',
  'calculation.approved': 'calculation.approved',
  'quality.scan_completed': 'trust.scan_completed',
  'compliance.evaluated': 'compliance.evaluated',
  'audit.simulation_completed': 'audit.simulation_completed',
  'audit.finding_raised': 'audit.finding_raised',
  'audit.package_generated': 'audit.package_generated',
  'integration.import_completed': 'integration.import_completed',
  'document.extraction_completed': 'document.extraction_completed',
  'supplier.request_submitted': 'supplier.request_submitted',
  'supplier.passport_recomputed': 'supplier.passport_recomputed',
};

/** Map an audit-log action string to a webhook event, or null if it is not one. */
export function webhookEventForAuditAction(action: string): WebhookEvent | null {
  return AUDIT_ACTION_TO_EVENT[action] ?? null;
}

// ---------------------------------------------------------------------------
// Payload envelope
// ---------------------------------------------------------------------------

export interface WebhookEventPayload {
  /** Stable id of this delivery attempt's logical event (the delivery row id). */
  id: string;
  event: WebhookEvent;
  organizationId: string;
  occurredAt: string;
  resource: {
    type: string;
    id: string | null;
  };
  /** The `after` snapshot from the audit entry, as-is. May be null. */
  data: unknown;
}

export interface BuildWebhookPayloadInput {
  deliveryId: string;
  event: WebhookEvent;
  organizationId: string;
  occurredAt: Date;
  resourceType: string;
  resourceId: string | null;
  data: unknown;
}

export function buildWebhookEventPayload(input: BuildWebhookPayloadInput): WebhookEventPayload {
  return {
    id: input.deliveryId,
    event: input.event,
    organizationId: input.organizationId,
    occurredAt: input.occurredAt.toISOString(),
    resource: { type: input.resourceType, id: input.resourceId },
    data: input.data ?? null,
  };
}

// ---------------------------------------------------------------------------
// Signing (Stripe-style `t=<ts>,v1=<hmac>`)
// ---------------------------------------------------------------------------

export const WEBHOOK_SIGNATURE_HEADER = 'x-trace-signature';
export const WEBHOOK_EVENT_HEADER = 'x-trace-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-trace-delivery';
/** Reject a signature whose timestamp is older than this (replay protection). */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

export function webhookSigningBase(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

export function signWebhookBody(secret: string, timestampSeconds: number, body: string): string {
  const mac = createHmac('sha256', secret)
    .update(webhookSigningBase(timestampSeconds, body))
    .digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

/** Verify a received signature header. Exposed so consumers (and tests) can reuse it. */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  body: string,
  now: Date = new Date(),
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const ts = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(ts) || !v1) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > WEBHOOK_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(webhookSigningBase(ts, body)).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Retry schedule
// ---------------------------------------------------------------------------

export const WEBHOOK_MAX_ATTEMPTS = 6;
/** Delay before attempt N (1-indexed). Capped exponential backoff. */
const BACKOFF_SECONDS = [0, 30, 120, 600, 1800, 7200];

export function webhookRetryDelayMs(nextAttempt: number): number {
  const idx = Math.min(Math.max(nextAttempt - 1, 0), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx]! * 1000;
}

export function webhookNextAttemptAt(nextAttempt: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + webhookRetryDelayMs(nextAttempt));
}

/** A 2xx is success; 408/425/429 and 5xx are retryable; everything else is fatal. */
export function isRetryableWebhookStatus(status: number): boolean {
  if (status >= 200 && status < 300) return false;
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}
