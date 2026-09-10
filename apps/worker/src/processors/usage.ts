import {
  activeOrganizationIds,
  ensureSubscription,
  getPrisma,
  pruneSamlLoginRequests,
  pruneSsoLoginRequests,
  withOrgContext,
} from '@trace/db';

/**
 * Periodic housekeeping (Phase 13c/13e/13f). `ensureSubscription` advances each
 * org's billing-period cursor at the month boundary; `pruneSsoLoginRequests` /
 * `pruneSamlLoginRequests` drop expired / consumed SSO login state. Runs every
 * few hours.
 */
export async function runUsageRollForward(): Promise<{
  orgs: number;
  prunedSsoRequests: number;
  prunedSamlRequests: number;
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
  return { orgs: orgIds.length, prunedSsoRequests, prunedSamlRequests };
}
