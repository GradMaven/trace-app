import { Module } from '@nestjs/common';
import { ProcurementController } from './procurement.controller';

@Module({ controllers: [ProcurementController] })
export class ProcurementModule {}
