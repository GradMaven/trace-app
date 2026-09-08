import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { EVIDENCE_TYPE } from '@trace/shared';
import { getContext } from '@trace/db';
import { CurrentActor } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { PortalGuard } from './portal.guard';
import { SupplierPortalService } from './supplier-portal.service';

const updateProfileSchema = z.object({
  industryNace: z.string().max(16).nullable().optional(),
  registrationIds: z.record(z.string(), z.string()).optional(),
});

const saveResponsesSchema = z.object({
  responses: z.record(z.string(), z.unknown()),
});

const addEvidenceSchema = z.object({
  type: z.enum(EVIDENCE_TYPE as unknown as [string, ...string[]]),
  title: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(2000).optional(),
  note: z.string().max(2000).optional(),
  reportingPeriod: z.string().max(60).optional(),
  requestId: z.string().uuid().optional(),
});

@ApiTags('supplier-portal')
@UseGuards(PortalGuard)
@Controller('supplier-portal')
export class SupplierPortalController {
  constructor(private readonly portal: SupplierPortalService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @ApiOperation({ summary: 'Portal overview for the signed-in supplier user.' })
  overview(@CurrentActor() actor: AuthenticatedActor): Promise<unknown> {
    return this.portal.overview(actor.organizationId!, actor.supplierId!);
  }

  @Patch('profile')
  @HttpCode(204)
  async updateProfile(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
  ): Promise<void> {
    await this.portal.updateProfile(
      actor.organizationId!,
      actor.supplierId!,
      actor.userId,
      body,
      this.rid(),
    );
  }

  @Get('requests')
  listRequests(@CurrentActor() actor: AuthenticatedActor): Promise<unknown[]> {
    return this.portal.listRequests(actor.organizationId!, actor.supplierId!);
  }

  @Get('requests/:requestId')
  getRequest(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('requestId') requestId: string,
  ): Promise<unknown> {
    return this.portal.getRequest(actor.organizationId!, actor.supplierId!, requestId);
  }

  @Put('requests/:requestId/responses')
  @HttpCode(200)
  @ApiOperation({ summary: 'Save (draft) questionnaire responses.' })
  saveResponses(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('requestId') requestId: string,
    @Body(new ZodPipe(saveResponsesSchema)) body: z.infer<typeof saveResponsesSchema>,
  ): Promise<{ completeness: number }> {
    return this.portal.saveResponses(
      actor.organizationId!,
      actor.supplierId!,
      requestId,
      actor.userId,
      body.responses,
      this.rid(),
    );
  }

  @Post('requests/:requestId/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit the questionnaire (validated); recomputes the Supplier Passport.' })
  submit(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('requestId') requestId: string,
  ): Promise<unknown> {
    return this.portal.submit(
      actor.organizationId!,
      actor.supplierId!,
      requestId,
      actor.userId,
      this.rid(),
    );
  }

  @Get('evidence')
  listEvidence(@CurrentActor() actor: AuthenticatedActor): Promise<unknown[]> {
    return this.portal.listEvidence(actor.organizationId!, actor.supplierId!);
  }

  @Post('evidence')
  @HttpCode(201)
  @ApiOperation({ summary: 'Attach an evidence reference (Phase 3 links these to stored documents).' })
  addEvidence(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(addEvidenceSchema)) body: z.infer<typeof addEvidenceSchema>,
  ): Promise<{ id: string }> {
    return this.portal.addEvidence(
      actor.organizationId!,
      actor.supplierId!,
      actor.userId,
      body,
      this.rid(),
    );
  }
}
