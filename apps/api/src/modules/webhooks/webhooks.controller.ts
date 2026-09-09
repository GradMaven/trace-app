import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SUBSCRIBABLE_WEBHOOK_EVENTS, WEBHOOK_EVENTS, isWebhookEvent } from '@trace/domain';
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getContext,
  listWebhookDeliveries,
  listWebhookEndpoints,
  retryWebhookDelivery,
  rollWebhookSecret,
  sendTestWebhook,
  updateWebhookEndpoint,
  webhookDeliveryById,
  withOrgContext,
  type WebhookDeliveryView,
  type WebhookEndpointView,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const eventArray = z
  .array(z.string())
  .min(1)
  .max(SUBSCRIBABLE_WEBHOOK_EVENTS.length)
  .refine((v) => v.every(isWebhookEvent), { message: 'Unknown webhook event.' });

const createSchema = z.object({
  url: z.string().url().max(2048),
  description: z.string().max(280).optional(),
  events: eventArray,
});
const updateSchema = z.object({
  url: z.string().url().max(2048).optional(),
  description: z.string().max(280).optional(),
  events: eventArray.optional(),
  status: z.enum(['active', 'paused']).optional(),
});
type CreateBody = z.infer<typeof createSchema>;
type UpdateBody = z.infer<typeof updateSchema>;

@ApiTags('webhooks')
@Controller('webhooks')
@RequirePermission('webhook.manage')
export class WebhooksController {
  @Get('events')
  @ApiOperation({ summary: 'The catalog of subscribable webhook events.' })
  events(): Array<{ event: string; description: string }> {
    return SUBSCRIBABLE_WEBHOOK_EVENTS.map((event) => ({
      event,
      description: WEBHOOK_EVENTS[event],
    }));
  }

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints (secrets are never returned after creation).' })
  list(@CurrentActor() actor: AuthenticatedActor): Promise<WebhookEndpointView[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      listWebhookEndpoints(db, actor.organizationId!),
    );
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a webhook endpoint. The signing secret is returned once.' })
  async create(
    @Body(new ZodPipe(createSchema)) body: CreateBody,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ id: string; secret: string }> {
    const requestId = getContext()?.requestId ?? 'unknown';
    return withOrgContext(actor.organizationId!, (db) =>
      createWebhookEndpoint(db, {
        organizationId: actor.organizationId!,
        url: body.url,
        description: body.description,
        events: body.events,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }

  @Patch(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Update a webhook endpoint (URL, events, description, or active/paused).',
  })
  async update(
    @Param('id') id: string,
    @Body(new ZodPipe(updateSchema)) body: UpdateBody,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await withOrgContext(actor.organizationId!, (db) =>
      updateWebhookEndpoint(db, {
        organizationId: actor.organizationId!,
        endpointId: id,
        url: body.url,
        description: body.description,
        events: body.events,
        status: body.status,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a webhook endpoint and its delivery history.' })
  async remove(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await withOrgContext(actor.organizationId!, (db) =>
      deleteWebhookEndpoint(db, {
        organizationId: actor.organizationId!,
        endpointId: id,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }

  @Post(':id/roll-secret')
  @ApiOperation({ summary: 'Rotate the signing secret. The new secret is returned once.' })
  rollSecret(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ secret: string }> {
    const requestId = getContext()?.requestId ?? 'unknown';
    return withOrgContext(actor.organizationId!, (db) =>
      rollWebhookSecret(db, {
        organizationId: actor.organizationId!,
        endpointId: id,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }

  @Post(':id/test')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue a synthetic `ping` delivery to verify the endpoint.' })
  test(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ deliveryId: string }> {
    const requestId = getContext()?.requestId ?? 'unknown';
    return withOrgContext(actor.organizationId!, (db) =>
      sendTestWebhook(db, {
        organizationId: actor.organizationId!,
        endpointId: id,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'Recent webhook deliveries, optionally filtered to one endpoint.' })
  deliveries(
    @CurrentActor() actor: AuthenticatedActor,
    @Query('endpointId') endpointId?: string,
    @Query('limit') limit?: string,
  ): Promise<WebhookDeliveryView[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      listWebhookDeliveries(db, actor.organizationId!, {
        endpointId: endpointId || undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    );
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'One delivery, with its signed payload and last response.' })
  delivery(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<WebhookDeliveryView> {
    return withOrgContext(actor.organizationId!, (db) =>
      webhookDeliveryById(db, actor.organizationId!, id),
    );
  }

  @Post('deliveries/:id/retry')
  @HttpCode(204)
  @ApiOperation({ summary: 'Re-queue a failed or dead delivery for another attempt.' })
  async retry(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await withOrgContext(actor.organizationId!, (db) =>
      retryWebhookDelivery(db, {
        organizationId: actor.organizationId!,
        deliveryId: id,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }
}
