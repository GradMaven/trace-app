import { Module } from '@nestjs/common';
import { EmissionFactorsController } from './emission-factors.controller';

@Module({ controllers: [EmissionFactorsController] })
export class EmissionFactorsModule {}
