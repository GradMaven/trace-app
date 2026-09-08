export {
  getPrisma,
  createPrisma,
  disconnectPrisma,
  withOrgContext,
  withPlatformContext,
  assertUuid,
} from './client';
export type { TenantDb, Prisma, PrismaClient } from './client';

export {
  runWithContext,
  getContext,
  requireContext,
  requireOrganizationId,
} from './context';
export type { RequestContext } from './context';

export { writeAuditLog, verifyAuditChain } from './audit';
export type { WriteAuditInput } from './audit';

export {
  PROVISIONING_ROLE_KEYS,
  provisionOrganization,
  ensurePermissionCatalog,
  ensurePlatformRole,
} from './provisioning';
export type { ProvisionOrganizationInput, ProvisionedOrganization } from './provisioning';
