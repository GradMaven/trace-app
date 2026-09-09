import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SsoAuthController } from './sso-auth.controller';
import { SsoConfigController } from './sso-config.controller';

@Module({
  imports: [AuthModule],
  controllers: [SsoAuthController, SsoConfigController],
})
export class SsoModule {}
