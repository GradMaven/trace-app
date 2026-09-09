import { Module } from '@nestjs/common';
import { AskController } from './ask.controller';

@Module({ controllers: [AskController] })
export class AskModule {}
