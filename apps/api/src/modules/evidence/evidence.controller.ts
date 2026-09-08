import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getContext } from '@trace/db';
import type { EvidenceStatus, Page } from '@trace/shared';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { EvidenceService, type EvidenceListItem } from './evidence.service';
import {
  createEvidenceSchema,
  linkDatapointSchema,
  listEvidenceQuerySchema,
  supersedeEvidenceSchema,
  transitionEvidenceSchema,
  type CreateEvidenceInput,
  type LinkDatapointBody,
  type ListEvidenceQuery,
  type SupersedeEvidenceBody,
  type TransitionEvidenceBody,
} from './evidence.dto';

@ApiTags('evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Post()
  @RequirePermission('evidence.create')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an evidence record (optionally backed by a document).' })
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createEvidenceSchema)) body: CreateEvidenceInput,
  ): Promise<{ id: string }> {
    return this.evidence.create(actor.organizationId!, actor.userId, body, this.rid());
  }

  @Get()
  @RequirePermission('evidence.read')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listEvidenceQuerySchema)) query: ListEvidenceQuery,
  ): Promise<Page<EvidenceListItem>> {
    return this.evidence.list(actor.organizationId!, query);
  }

  @Get(':id')
  @RequirePermission('evidence.read')
  @ApiOperation({ summary: 'Evidence detail: document, linked datapoints, version chain, verifications.' })
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.evidence.get(actor.organizationId!, id);
  }

  @Post(':id/transition')
  @RequirePermission('evidence.update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move evidence through its lifecycle (verify/reject need evidence.verify).' })
  transition(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(transitionEvidenceSchema)) body: TransitionEvidenceBody,
  ): Promise<{ id: string; status: EvidenceStatus }> {
    return this.evidence.transition(
      actor.organizationId!,
      id,
      actor.userId,
      body.to as EvidenceStatus,
      actor.permissions,
      { method: body.method, note: body.note },
      this.rid(),
    );
  }

  @Post(':id/supersede')
  @RequirePermission('evidence.update')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new version of this evidence; marks the current one superseded.' })
  supersede(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(supersedeEvidenceSchema)) body: SupersedeEvidenceBody,
  ): Promise<{ id: string; version: number }> {
    return this.evidence.supersede(actor.organizationId!, id, actor.userId, body, this.rid());
  }

  @Post(':id/datapoints')
  @RequirePermission('evidence.update')
  @HttpCode(204)
  @ApiOperation({ summary: 'Link a datapoint to this evidence.' })
  async link(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(linkDatapointSchema)) body: LinkDatapointBody,
  ): Promise<void> {
    await this.evidence.linkDatapoint(
      actor.organizationId!,
      id,
      body.datapointId,
      actor.userId,
      this.rid(),
    );
  }

  @Delete(':id/datapoints/:datapointId')
  @RequirePermission('evidence.update')
  @HttpCode(204)
  async unlink(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Param('datapointId') datapointId: string,
  ): Promise<void> {
    await this.evidence.unlinkDatapoint(
      actor.organizationId!,
      id,
      datapointId,
      actor.userId,
      this.rid(),
    );
  }
}
