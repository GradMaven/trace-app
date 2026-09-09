import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextMiddleware } from './common/request-context';
import { AuthGuard } from './common/auth.guard';
import { CsrfGuard } from './common/csrf.guard';
import { PermissionsGuard } from './common/permissions.guard';
import { QuotaGuard } from './common/quota.guard';
import { UsageInterceptor } from './common/usage.interceptor';
import { AppExceptionFilter } from './common/app-exception.filter';
import { CatalogBootstrap } from './bootstrap/catalog.bootstrap';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { MembersModule } from './modules/members/members.module';
import { RolesModule } from './modules/roles/roles.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { SupplierPortalModule } from './modules/supplier-portal/supplier-portal.module';
import { StorageModule } from './modules/storage/storage.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { DatapointsModule } from './modules/datapoints/datapoints.module';
import { EmissionFactorsModule } from './modules/emission-factors/emission-factors.module';
import { ActivityDataModule } from './modules/activity-data/activity-data.module';
import { CalculationsModule } from './modules/calculations/calculations.module';
import { EmissionsModule } from './modules/emissions/emissions.module';
import { AiModule } from './modules/ai/ai.module';
import { CandidateDatapointsModule } from './modules/candidate-datapoints/candidate-datapoints.module';
import { TrustModule } from './modules/trust/trust.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { AuditWorkspaceModule } from './modules/audit/audit.module';
import { CommandCenterModule } from './modules/command-center/command-center.module';
import { AskModule } from './modules/ask/ask.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { MfaModule } from './modules/mfa/mfa.module';
import { ExportsModule } from './modules/exports/exports.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { UsageModule } from './modules/usage/usage.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    MeModule,
    OrganizationsModule,
    MembersModule,
    RolesModule,
    AuditLogModule,
    SuppliersModule,
    SupplierPortalModule,
    StorageModule,
    DocumentsModule,
    EvidenceModule,
    DatapointsModule,
    EmissionFactorsModule,
    ActivityDataModule,
    CalculationsModule,
    EmissionsModule,
    AiModule,
    CandidateDatapointsModule,
    TrustModule,
    ComplianceModule,
    AuditWorkspaceModule,
    CommandCenterModule,
    AskModule,
    ProcurementModule,
    IntegrationsModule,
    ApiKeysModule,
    WebhooksModule,
    MfaModule,
    ExportsModule,
    GovernanceModule,
    UsageModule,
  ],
  providers: [
    CatalogBootstrap,
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    // Order matters: authenticate -> CSRF -> permission check.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: QuotaGuard },
    { provide: APP_INTERCEPTOR, useClass: UsageInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
