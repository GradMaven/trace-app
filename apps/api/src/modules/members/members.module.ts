import { Module } from '@nestjs/common';
import { EmailService } from '../auth/email.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [MembersController],
  providers: [MembersService, EmailService],
})
export class MembersModule {}
