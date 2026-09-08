import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '@trace/shared';
import { getContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import type { RequestWithContext } from '../../common/request-context';
import { OrganizationsService, type OrganizationView } from './organizations.service';
import { createOrganizationSchema, type CreateOrganizationInput } from './organizations.dto';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an organization. The caller becomes its Organization Admin.' })
  async create(
    @Body(new ZodPipe(createOrganizationSchema)) body: CreateOrganizationInput,
    @Req() req: Request,
  ): Promise<OrganizationView> {
    const actor = (req as RequestWithContext & { actor?: AuthenticatedActor }).actor!;
    const requestId = getContext()?.requestId ?? 'unknown';
    return this.organizations.create(body, actor.userId, requestId);
  }

  @Get(':id')
  @RequirePermission('organization.read')
  @ApiOperation({ summary: 'Read an organization the caller is a member of.' })
  async getById(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<OrganizationView> {
    if (id !== actor.organizationId) {
      // No cross-tenant existence disclosure.
      throw AppError.notFound('organization.not_found', 'Organization not found.');
    }
    return this.organizations.getByIdOrThrow(id);
  }
}
