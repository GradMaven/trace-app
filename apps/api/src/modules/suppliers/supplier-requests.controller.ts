import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { getContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { SupplierRequestsService } from './supplier-requests.service';

const createRequestSchema = z.object({
  title: z.string().max(160).optional(),
  message: z.string().max(2000).optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const listQuerySchema = z.object({
  status: z
    .enum(['draft', 'sent', 'in_progress', 'submitted', 'accepted', 'declined'])
    .optional(),
});

@ApiTags('suppliers')
@Controller()
export class SupplierRequestsController {
  constructor(private readonly requests: SupplierRequestsService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Post('suppliers/:id/requests')
  @RequirePermission('supplier.request')
  @HttpCode(201)
  @ApiOperation({ summary: 'Send a sustainability questionnaire to a supplier.' })
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') supplierId: string,
    @Body(new ZodPipe(createRequestSchema)) body: z.infer<typeof createRequestSchema>,
  ): Promise<{ id: string }> {
    return this.requests.create(actor.organizationId!, supplierId, actor.userId, body, this.rid());
  }

  @Get('supplier-requests')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'List all supplier information requests in the organization.' })
  listAll(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listQuerySchema)) query: { status?: string },
  ): Promise<unknown[]> {
    return this.requests.listAll(actor.organizationId!, query.status);
  }

  @Get('suppliers/:id/requests')
  @RequirePermission('supplier.read')
  listForSupplier(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') supplierId: string,
  ): Promise<unknown[]> {
    return this.requests.list(actor.organizationId!, supplierId);
  }

  @Get('supplier-requests/:requestId')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'Request detail with the questionnaire template and current responses.' })
  get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('requestId') requestId: string,
  ): Promise<unknown> {
    return this.requests.get(actor.organizationId!, requestId);
  }

  @Post('supplier-requests/:requestId/accept')
  @RequirePermission('supplier.request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a submitted questionnaire; recomputes the Supplier Passport.' })
  accept(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('requestId') requestId: string,
  ): Promise<unknown> {
    return this.requests.accept(actor.organizationId!, requestId, actor.userId, this.rid());
  }
}
