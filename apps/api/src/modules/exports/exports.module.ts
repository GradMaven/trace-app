import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';

// STORAGE_SERVICE is provided by the @Global() StorageModule.
@Module({ controllers: [ExportsController] })
export class ExportsModule {}
