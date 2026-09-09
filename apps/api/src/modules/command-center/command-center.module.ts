import { Module } from '@nestjs/common';
import { CommandCenterController } from './command-center.controller';

@Module({ controllers: [CommandCenterController] })
export class CommandCenterModule {}
