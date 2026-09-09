import { dispatchDueWebhookDeliveries, getPrisma, type WebhookFetch } from '@trace/db';

/**
 * Outbound-webhook dispatcher (Phase 13). Runs on an interval in the worker:
 * one pass delivers every due `webhook_delivery`, signs it, records the
 * response, and reschedules with backoff. All retry/backoff/dead-letter logic
 * lives in `@trace/db.dispatchDueWebhookDeliveries`; this is just the transport.
 */

const REQUEST_TIMEOUT_MS = 10_000;

const httpFetch: WebhookFetch = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'manual',
  });
  return { status: res.status, text: () => res.text() };
};

export async function runWebhookDispatchPass(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  dead: number;
}> {
  return dispatchDueWebhookDeliveries(getPrisma(), {
    fetch: httpFetch,
    userAgent: 'TRACE-Webhooks/1.0',
  });
}
