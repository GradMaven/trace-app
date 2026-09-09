import { Module } from '@nestjs/common';
import { AuditStreamsController } from './audit-streams.controller';

@Module({ controllers: [AuditStreamsController] })
export class AuditStreamsModule {}
