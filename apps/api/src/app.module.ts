import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RequestContextMiddleware } from './common/request-context';
import { AuthGuard } from './common/auth.guard';
import { CsrfGuard } from './common/csrf.guard';
import { PermissionsGuard } from './common/permissions.guard';
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
  ],
  providers: [
    CatalogBootstrap,
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    // Order matters: authenticate -> CSRF -> permission check.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
