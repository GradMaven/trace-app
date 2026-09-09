import { Module } from '@nestjs/common';
import { MetricsController, OpsController } from './ops.controller';

@Module({ controllers: [OpsController, MetricsController] })
export class OpsModule {}
