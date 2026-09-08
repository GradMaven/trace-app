import { Module } from '@nestjs/common';
import { EmissionsController } from './emissions.controller';

@Module({ controllers: [EmissionsController] })
export class EmissionsModule {}
