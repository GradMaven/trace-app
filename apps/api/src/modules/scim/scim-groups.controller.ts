import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '@trace/shared';
import { loadEnv } from '@trace/config';
import {
  normalizeScimPatch,
  parseScimFilter,
  parseScimGroup,
  scimGroupResource,
  scimListResponse,
  scimPaginationParams,
} from '@trace/domain';
import {
  getContext,
  scimCreateGroup,
  scimDeleteGroup,
  scimGetGroup,
  scimListGroups,
  scimPatchGroup,
  scimReplaceGroup,
  withOrgContext,
  type ScimGroupWithMembers,
} from '@trace/db';
import { MfaExempt, Public } from '../../common/decorators';
import { ScimAuthGuard, type ScimRequestContext } from './scim-auth.guard';
import { ScimExceptionFilter } from './scim-exception.filter';
import { ScimContentTypeInterceptor } from './scim.interceptor';

type ScimReq = Request & { scim: ScimRequestContext };

@ApiExcludeController()
@Public()
@MfaExempt()
@Controller('scim/v2/:orgSlug/Groups')
@UseGuards(ScimAuthGuard)
@UseFilters(ScimExceptionFilter)
@UseInterceptors(ScimContentTypeInterceptor)
export class ScimGroupsController {
  private baseUrl(slug: string): string {
    return `${loadEnv().API_PUBLIC_URL}/api/v1/scim/v2/${slug}`;
  }
  private ctx(): { requestId: string } {
    return { requestId: getContext()?.requestId ?? 'unknown' };
  }
  private render(slug: string, g: ScimGroupWithMembers): Record<string, unknown> {
    return scimGroupResource(g.model, g.members, { baseUrl: this.baseUrl(slug) });
  }

  @Get()
  async list(
    @Param('orgSlug') slug: string,
    @Query() query: Record<string, string>,
    @Req() req: ScimReq,
  ): Promise<Record<string, unknown>> {
    const org = req.scim.organizationId;
    const { startIndex, count } = scimPaginationParams(query);
    const parsed = parseScimFilter(query.filter);
    const filter = parsed ? { attribute: parsed.attribute, value: parsed.value } : null;
    const { resources, totalResults } = await withOrgContext(org, (db) =>
      scimListGroups(db, org, { filter, startIndex, count }),
    );
    return scimListResponse(
      resources.map((g) => this.render(slug, g)),
      { totalResults, startIndex },
    );
  }

  @Get(':id')
  async getOne(
    @Param('orgSlug') slug: string,
    @Param('id') id: string,
    @Req() req: ScimReq,
  ): Promise<Record<string, unknown>> {
    const org = req.scim.organizationId;
    const g = await withOrgContext(org, (db) => scimGetGroup(db, org, id));
    if (!g) throw AppError.notFound('scim.not_found', 'Group not found.');
    return this.render(slug, g);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Param('orgSlug') slug: string,
    @Body() body: unknown,
    @Req() req: ScimReq,
  ): Promise<Record<string, unknown>> {
    const parsed = parseScimGroup(body);
    if ('error' in parsed) throw AppError.unprocessable('scim.invalid_value', parsed.error);
    const org = req.scim.organizationId;
    const g = await withOrgContext(org, (db) => scimCreateGroup(db, org, parsed, this.ctx()));
    return this.render(slug, g);
  }

  @Put(':id')
  async replace(
    @Param('orgSlug') slug: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScimReq,
  ): Promise<Record<string, unknown>> {
    const parsed = parseScimGroup(body);
    if ('error' in parsed) throw AppError.unprocessable('scim.invalid_value', parsed.error);
    const org = req.scim.organizationId;
    const g = await withOrgContext(org, (db) => scimReplaceGroup(db, org, id, parsed, this.ctx()));
    return this.render(slug, g);
  }

  @Patch(':id')
  async patch(
    @Param('orgSlug') slug: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: ScimReq,
  ): Promise<Record<string, unknown>> {
    const norm = normalizeScimPatch(body);
    if ('error' in norm) throw AppError.unprocessable('scim.invalid_value', norm.error);
    const org = req.scim.organizationId;
    const g = await withOrgContext(org, (db) =>
      scimPatchGroup(db, org, id, norm.operations, this.ctx()),
    );
    return this.render(slug, g);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: ScimReq): Promise<void> {
    const org = req.scim.organizationId;
    await withOrgContext(org, (db) => scimDeleteGroup(db, org, id, this.ctx()));
  }
}
