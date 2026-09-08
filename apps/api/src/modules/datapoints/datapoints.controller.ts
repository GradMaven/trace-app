import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getContext } from '@trace/db';
import type { Page } from '@trace/shared';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { DatapointsService, type DatapointView } from './datapoints.service';
import {
  createDatapointSchema,
  listDatapointsQuerySchema,
  type CreateDatapointInput,
  type ListDatapointsQuery,
} from './datapoints.dto';

@ApiTags('datapoints')
@Controller('datapoints')
export class DatapointsController {
  constructor(private readonly datapoints: DatapointsService) {}

  @Post()
  @RequirePermission('activity.create')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a material datapoint (value + provenance + subject).' })
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createDatapointSchema)) body: CreateDatapointInput,
  ): Promise<{ id: string }> {
    const rid = getContext()?.requestId ?? 'unknown';
    return this.datapoints.create(actor.organizationId!, actor.userId, body, rid);
  }

  @Get()
  @RequirePermission('activity.read')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listDatapointsQuerySchema)) query: ListDatapointsQuery,
  ): Promise<Page<DatapointView>> {
    return this.datapoints.list(actor.organizationId!, query);
  }

  @Get(':id')
  @RequirePermission('activity.read')
  @ApiOperation({ summary: 'Datapoint with its linked evidence (Evidence DNA).' })
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.datapoints.get(actor.organizationId!, id);
  }
}
