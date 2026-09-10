import { Module } from '@nestjs/common';
import { ScimConfigController } from './scim-config.controller';
import { ScimDiscoveryController } from './scim-discovery.controller';
import { ScimGroupsController } from './scim-groups.controller';
import { ScimUsersController } from './scim-users.controller';
import { ScimAuthGuard } from './scim-auth.guard';
import { ScimExceptionFilter } from './scim-exception.filter';
import { ScimContentTypeInterceptor } from './scim.interceptor';

@Module({
  controllers: [
    ScimConfigController,
    ScimUsersController,
    ScimGroupsController,
    ScimDiscoveryController,
  ],
  providers: [ScimAuthGuard, ScimExceptionFilter, ScimContentTypeInterceptor],
})
export class ScimModule {}
