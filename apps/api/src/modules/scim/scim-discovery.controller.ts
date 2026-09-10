import {
  Controller,
  Get,
  Param,
  Req,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { loadEnv } from '@trace/config';
import {
  scimResourceTypes,
  scimSchemas,
  scimServiceProviderConfig,
} from '@trace/domain';
import { MfaExempt, Public } from '../../common/decorators';
import { ScimAuthGuard } from './scim-auth.guard';
import { ScimExceptionFilter } from './scim-exception.filter';
import { ScimContentTypeInterceptor } from './scim.interceptor';

/** RFC 7644 §4 discovery endpoints. Bearer-authenticated like the rest. */
@ApiExcludeController()
@Public()
@MfaExempt()
@Controller('scim/v2/:orgSlug')
@UseGuards(ScimAuthGuard)
@UseFilters(ScimExceptionFilter)
@UseInterceptors(ScimContentTypeInterceptor)
export class ScimDiscoveryController {
  private baseUrl(slug: string): string {
    return `${loadEnv().API_PUBLIC_URL}/api/v1/scim/v2/${slug}`;
  }

  @Get('ServiceProviderConfig')
  serviceProviderConfig(@Param('orgSlug') slug: string): Record<string, unknown> {
    return scimServiceProviderConfig({ baseUrl: this.baseUrl(slug) });
  }

  @Get('ResourceTypes')
  resourceTypes(@Param('orgSlug') slug: string): Record<string, unknown>[] {
    return scimResourceTypes({ baseUrl: this.baseUrl(slug) });
  }

  @Get('Schemas')
  schemas(@Req() _req: Request): Record<string, unknown>[] {
    return scimSchemas();
  }
}
