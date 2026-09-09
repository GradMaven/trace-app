import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditPackagesController } from './audit-packages.controller';

@Module({ controllers: [AuditController, AuditPackagesController] })
export class AuditWorkspaceModule {}
