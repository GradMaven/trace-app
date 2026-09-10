import {
  activeOrganizationIds,
  ensureSubscription,
  expireStaleCheckouts,
  getPrisma,
  pruneSamlLoginRequests,
  pruneSsoLoginRequests,
  withOrgContext,
} from '@trace/db';

/**
 * Periodic housekeeping (Phase 13c/13e/13f/13h). `ensureSubscription` advances
 * each org's billing-period cursor at the month boundary; the prune helpers drop
 * expired SSO login state; `expireStaleCheckouts` marks abandoned billing
 * checkouts as expired. Runs every few hours.
 */
export async function runUsageRollForward(): Promise<{
  orgs: number;
  prunedSsoRequests: number;
  prunedSamlRequests: number;
  expiredCheckouts: number;
}> {
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
  const prunedSamlRequests = await pruneSamlLoginRequests(prisma).catch(() => 0);
  const expiredCheckouts = await expireStaleCheckouts(prisma).catch(() => 0);
  return { orgs: orgIds.length, prunedSsoRequests, prunedSamlRequests, expiredCheckouts };
}
