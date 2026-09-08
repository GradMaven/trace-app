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

export { recomputeSupplierPassport } from './supplier';
export type { RecomputePassportArgs, RecomputedPassport } from './supplier';

export { transitionEvidence, supersedeEvidence } from './evidence';
export type { TransitionEvidenceArgs, SupersedeEvidenceArgs } from './evidence';

export {
  runCalculation,
  reproduceCalculation,
  recomputeCalculation,
  recomputeEmissions,
  inventorySummary,
} from './carbon';
export type { RunCalculationArgs, RunCalculationResult } from './carbon';

export { runExtractionPipeline, promoteCandidate, rejectCandidate } from './ai-pipeline';
export type {
  PipelineDeps,
  RunExtractionArgs,
  RunExtractionResult,
  PromoteCandidateArgs,
} from './ai-pipeline';
