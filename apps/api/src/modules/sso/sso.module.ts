import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SsoAuthController } from './sso-auth.controller';
import { SsoConfigController } from './sso-config.controller';
import { SamlAuthController } from './saml-auth.controller';
import { SamlConfigController } from './saml-config.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    SsoAuthController,
    SsoConfigController,
    SamlAuthController,
    SamlConfigController,
  ],
})
export class SsoModule {}
