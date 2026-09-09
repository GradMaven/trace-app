import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { RetentionController } from './retention.controller';

@Module({ controllers: [SecurityController, RetentionController] })
export class GovernanceModule {}
