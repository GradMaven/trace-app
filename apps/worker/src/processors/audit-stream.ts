import {
  activeOrganizationIds,
  dispatchOrgAuditStreams,
  getPrisma,
  withOrgContext,
  writeHeartbeat,
  type WebhookFetch,
} from '@trace/db';

/**
 * Audit-log stream dispatcher (Phase 13d). Per active org, `dispatchOrgAuditStreams`
 * retries any in-flight delivery and/or reads the next window of `audit_log`
 * after each stream's cursor and POSTs a signed batch. `audit_stream` is
 * RLS-scoped, so the sweep enumerates orgs from `organization` and opens
 * `withOrgContext` per org (like the retention sweep).
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

export async function runAuditStreamDispatch(): Promise<{
  orgs: number;
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  const prisma = getPrisma();
  const orgIds = await activeOrganizationIds(prisma);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  for (const organizationId of orgIds) {
    try {
      const r = await withOrgContext(organizationId, (db) =>
        dispatchOrgAuditStreams(db, { fetch: httpFetch, userAgent: 'TRACE-AuditStream/1.0' }),
      );
      attempted += r.attempted;
      succeeded += r.succeeded;
      failed += r.failed;
    } catch {
      // one org's failure should not stop the sweep
    }
  }
  return { orgs: orgIds.length, attempted, succeeded, failed };
}

export async function beatWorkerHeartbeat(): Promise<void> {
  await writeHeartbeat(getPrisma(), 'worker', { pid: process.pid, ts: Date.now() });
}
