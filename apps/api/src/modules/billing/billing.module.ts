import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingConfigController } from './billing-config.controller';

@Module({
  controllers: [BillingController, BillingConfigController],
})
export class BillingModule {}
