import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getContext } from '@trace/db';
import type { Page } from '@trace/shared';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { ActivityDataService, type ActivityListItem } from './activity-data.service';
import {
  createActivitySchema,
  linkEvidenceSchema,
  listActivityQuerySchema,
  updateActivitySchema,
  type CreateActivityInput,
  type ListActivityQuery,
  type UpdateActivityInput,
} from './activity-data.dto';

@ApiTags('activity-data')
@Controller('activity-data')
export class ActivityDataController {
  constructor(private readonly activity: ActivityDataService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Post()
  @RequirePermission('activity.create')
  @HttpCode(201)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createActivitySchema)) body: CreateActivityInput,
  ): Promise<{ id: string }> {
    return this.activity.create(actor.organizationId!, actor.userId, body, this.rid());
  }

  @Get()
  @RequirePermission('activity.read')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listActivityQuerySchema)) query: ListActivityQuery,
  ): Promise<Page<ActivityListItem>> {
    return this.activity.list(actor.organizationId!, query);
  }

  @Get(':id')
  @RequirePermission('activity.read')
  @ApiOperation({ summary: 'Activity detail with linked evidence and calculations.' })
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.activity.get(actor.organizationId!, id);
  }

  @Patch(':id')
  @RequirePermission('activity.update')
  @HttpCode(204)
  async update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(updateActivitySchema)) body: UpdateActivityInput,
  ): Promise<void> {
    await this.activity.update(actor.organizationId!, id, actor.userId, body, this.rid());
  }

  @Delete(':id')
  @RequirePermission('activity.update')
  @HttpCode(204)
  async remove(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<void> {
    await this.activity.softDelete(actor.organizationId!, id, actor.userId, this.rid());
  }

  @Post(':id/evidence')
  @RequirePermission('activity.update')
  @HttpCode(204)
  @ApiOperation({ summary: 'Link an evidence record to this activity.' })
  async link(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(linkEvidenceSchema)) body: { evidenceId: string },
  ): Promise<void> {
    await this.activity.linkEvidence(
      actor.organizationId!,
      id,
      body.evidenceId,
      actor.userId,
      this.rid(),
    );
  }

  @Delete(':id/evidence/:evidenceId')
  @RequirePermission('activity.update')
  @HttpCode(204)
  async unlink(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ): Promise<void> {
    await this.activity.unlinkEvidence(
      actor.organizationId!,
      id,
      evidenceId,
      actor.userId,
      this.rid(),
    );
  }
}
