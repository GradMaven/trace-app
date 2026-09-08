import { Module } from '@nestjs/common';
import { TrustController } from './trust.controller';
import { DataQualityController } from './data-quality.controller';

@Module({ controllers: [TrustController, DataQualityController] })
export class TrustModule {}
