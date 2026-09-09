import { activeOrganizationIds, getPrisma, runRetention, withOrgContext } from '@trace/db';

/**
 * Retention sweep (Phase 13b). On a schedule the worker records a **dry-run**
 * for every enabled policy in every active org, so admins can see what would be
 * purged. Actual deletion (`apply`) is always a deliberate manual action from
 * the Settings screen — the worker never deletes on its own.
 *
 * `retention_policy` is RLS-scoped, so the sweep enumerates orgs from the
 * repository-scoped `organization` table and opens `withOrgContext` per org.
 */
export async function runRetentionSweep(): Promise<{ orgs: number; policies: number }> {
  const prisma = getPrisma();
  const orgIds = await activeOrganizationIds(prisma);
  let policies = 0;
  for (const organizationId of orgIds) {
    try {
      const summaries = await withOrgContext(organizationId, (db) =>
        runRetention(db, {
          organizationId,
          mode: 'dry_run',
          actorUserId: null,
          requestId: 'worker:retention-sweep',
        }),
      );
      policies += summaries.length;
    } catch {
      // one org's failure should not stop the sweep
    }
  }
  return { orgs: orgIds.length, policies };
}
