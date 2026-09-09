import { activeOrganizationIds, ensureSubscription, getPrisma, withOrgContext } from '@trace/db';

/**
 * Usage period roll-forward (Phase 13c). `ensureSubscription` advances an org's
 * `currentPeriod` cursor to the live billing period; counters are already keyed
 * by period so a new month starts fresh automatically. Runs every few hours;
 * only does work at a month boundary.
 */
export async function runUsageRollForward(): Promise<{ orgs: number }> {
  const prisma = getPrisma();
  const orgIds = await activeOrganizationIds(prisma);
  for (const organizationId of orgIds) {
    try {
      await withOrgContext(organizationId, (db) => ensureSubscription(db, organizationId));
    } catch {
      // one org's failure should not stop the sweep
    }
  }
  return { orgs: orgIds.length };
}
