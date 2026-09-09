import {
  activeOrganizationIds,
  ensureSubscription,
  getPrisma,
  pruneSsoLoginRequests,
  withOrgContext,
} from '@trace/db';

/**
 * Periodic housekeeping (Phase 13c/13e). `ensureSubscription` advances each org's
 * billing-period cursor at the month boundary; `pruneSsoLoginRequests` drops
 * expired / consumed OIDC login state. Runs every few hours.
 */
export async function runUsageRollForward(): Promise<{ orgs: number; prunedSsoRequests: number }> {
  const prisma = getPrisma();
  const orgIds = await activeOrganizationIds(prisma);
  for (const organizationId of orgIds) {
    try {
      await withOrgContext(organizationId, (db) => ensureSubscription(db, organizationId));
    } catch {
      // one org's failure should not stop the sweep
    }
  }
  const prunedSsoRequests = await pruneSsoLoginRequests(prisma).catch(() => 0);
  return { orgs: orgIds.length, prunedSsoRequests };
}
