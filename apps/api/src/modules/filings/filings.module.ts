import { Module } from '@nestjs/common';
import { FilingsController } from './filings.controller';

@Module({ controllers: [FilingsController] })
export class FilingsModule {}
