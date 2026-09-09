import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createAuditStream,
  deleteAuditStream,
  getContext,
  listAuditStreamDeliveries,
  listAuditStreams,
  rotateAuditStreamSecret,
  sendTestAuditStream,
  updateAuditStream,
  withOrgContext,
  type AuditStreamDeliveryView,
  type AuditStreamView,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const prefixArr = z.array(z.string().max(64)).max(30).optional();
const filterSchema = z.object({
  actionPrefixes: prefixArr,
  resourceTypes: prefixArr,
});
const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().url().max(2048),
  filters: filterSchema.optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  url: z.string().url().max(2048).optional(),
  filters: filterSchema.optional(),
  status: z.enum(['active', 'paused']).optional(),
});

@ApiTags('audit-streams')
@Controller('settings/audit-streams')
@RequirePermission('audit_stream.manage')
export class AuditStreamsController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @ApiOperation({ summary: 'List audit-log stream endpoints (secrets are never returned).' })
  list(@CurrentActor() actor: AuthenticatedActor): Promise<AuditStreamView[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      listAuditStreams(db, actor.organizationId!),
    );
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an audit stream. The signing secret is returned once.' })
  create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ id: string; secret: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      createAuditStream(db, {
        organizationId: actor.organizationId!,
        name: body.name,
        url: body.url,
        filters: body.filters,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Patch(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Update a stream (URL, filters, name, or active/paused).' })
  async update(
    @Param('id') id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      updateAuditStream(db, {
        organizationId: actor.organizationId!,
        streamId: id,
        name: body.name,
        url: body.url,
        filters: body.filters,
        status: body.status,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a stream and its delivery history.' })
  async remove(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      deleteAuditStream(db, {
        organizationId: actor.organizationId!,
        streamId: id,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Post(':id/rotate-secret')
  @ApiOperation({ summary: 'Rotate the signing secret. The new secret is returned once.' })
  rotate(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ secret: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      rotateAuditStreamSecret(db, {
        organizationId: actor.organizationId!,
        streamId: id,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Post(':id/test')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue a synthetic ping batch to verify the endpoint.' })
  test(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ deliveryId: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      sendTestAuditStream(db, {
        organizationId: actor.organizationId!,
        streamId: id,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'Recent stream delivery attempts, optionally for one stream.' })
  deliveries(
    @CurrentActor() actor: AuthenticatedActor,
    @Query('streamId') streamId?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditStreamDeliveryView[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      listAuditStreamDeliveries(db, actor.organizationId!, {
        streamId: streamId || undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  }
}
