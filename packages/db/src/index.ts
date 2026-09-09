export {
  getPrisma,
  createPrisma,
  disconnectPrisma,
  withOrgContext,
  withPlatformContext,
  assertUuid,
} from './client';
export type { TenantDb, Prisma, PrismaClient } from './client';

export { runWithContext, getContext, requireContext, requireOrganizationId } from './context';
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

export {
  scoreDatapointTrust,
  runQualityScan,
  updateIssueStatus,
  updateAnomalyStatus,
  datapointTrust,
  qualitySummary,
} from './trust';
export type {
  ScoreDatapointTrustArgs,
  TrustScoreOutcome,
  RunQualityScanArgs,
  QualityScanResult,
  QualitySummary,
} from './trust';

export {
  loadRuleStore,
  runComplianceEvaluation,
  confirmMapping,
  upsertControl,
  complianceOverview,
  disclosureDetail,
  complianceGaps,
  listRuleStoreVersions,
} from './compliance';
export type { LoadRuleStoreResult, RunComplianceArgs, RunComplianceResult } from './compliance';

export {
  runAuditSimulation,
  createAudit,
  updateAudit,
  createFinding,
  updateFinding,
  generateAuditPackage,
  auditReadiness,
  evidenceReviewList,
  evidenceChain,
} from './audit-workspace';
export type {
  RunAuditSimulationArgs,
  RunAuditSimulationResult,
  AuditPackageDeps,
  GenerateAuditPackageArgs,
  GenerateAuditPackageResult,
} from './audit-workspace';

export { commandCenterOverview } from './command-center';
export type { CommandCenterOverview } from './command-center';

export { runAskQuery, askHistory, askQueryById } from './ask';
export type { AskDeps, RunAskQueryArgs, RunAskQueryResult, RetrievedRecord } from './ask';

export {
  supplierCarbonComparison,
  scenarioLinesForSuppliers,
  runProcurementScenario,
  listProcurementScenarios,
  procurementScenarioById,
} from './procurement';
export type { RunProcurementScenarioArgs, RunProcurementScenarioResult } from './procurement';

export {
  previewImport,
  commitImport,
  createIntegration,
  updateIntegration,
  listIntegrations,
  listIntegrationRuns,
  integrationRunById,
} from './integrations';
export type { CommitImportArgs, CommitImportResult } from './integrations';

export {
  createApiKey,
  revokeApiKey,
  listApiKeys,
  authenticateApiKey,
  createWebhookEndpoint,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  rollWebhookSecret,
  listWebhookEndpoints,
  listWebhookDeliveries,
  webhookDeliveryById,
  retryWebhookDelivery,
  sendTestWebhook,
  dispatchDueWebhookDeliveries,
} from './access';
export type {
  CreateApiKeyArgs,
  CreateApiKeyResult,
  ApiKeyView,
  AuthenticatedApiKey,
  CreateWebhookEndpointArgs,
  UpdateWebhookEndpointArgs,
  WebhookEndpointView,
  WebhookDeliveryView,
  DispatchWebhooksDeps,
  DispatchWebhooksResult,
  WebhookFetch,
} from './access';

export {
  getMfaStatus,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  verifyMfaChallenge,
  disableMfa,
  resolveMfaRequirement,
} from './mfa';
export type { MfaStatus } from './mfa';

export {
  runExport,
  listExportJobs,
  exportJobById,
  expireStaleExports,
  upsertRetentionPolicy,
  deleteRetentionPolicy,
  listRetentionPolicies,
  listRetentionRuns,
  runRetention,
  activeOrganizationIds,
  RETENTION_TARGET_KEYS,
} from './governance';
export type {
  ExportDeps,
  RunExportArgs,
  RunExportResult,
  ExportJobView,
  RetentionPolicyView,
  RunRetentionArgs,
  RetentionRunSummary,
} from './governance';
