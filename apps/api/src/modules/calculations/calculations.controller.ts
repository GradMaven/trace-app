import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { GHG_SCOPE, METHODOLOGY, type Page } from '@trace/shared';
import { getContext } from '@trace/db';
import { CurrentActor, Metered, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { CalculationsService, type CalculationListItem } from './calculations.service';

const runSchema = z.object({
  activityId: z.string().uuid(),
  emissionFactorId: z.string().uuid().optional(),
  methodology: z.enum(METHODOLOGY as unknown as [string, ...string[]]).optional(),
  geography: z.string().max(12).nullish(),
  assumptions: z.record(z.string(), z.unknown()).optional(),
});

const listQuerySchema = z.object({
  reportingPeriod: z.string().max(60).optional(),
  scope: z.enum(GHG_SCOPE as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

@ApiTags('calculations')
@Controller('calculations')
export class CalculationsController {
  constructor(private readonly calculations: CalculationsService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Post('run')
  @RequirePermission('calculation.run')
  @Metered('calculation_run')
  @HttpCode(201)
  @ApiOperation({ summary: 'Run a deterministic emissions calculation for an activity.' })
  run(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>,
  ): Promise<unknown> {
    return this.calculations.run(actor.organizationId!, actor.userId, body, this.rid());
  }

  @Get()
  @RequirePermission('calculation.read')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Page<CalculationListItem>> {
    return this.calculations.list(actor.organizationId!, query);
  }

  @Get(':id/lineage')
  @RequirePermission('calculation.read')
  @ApiOperation({ summary: 'Full calculation lineage: activity, evidence, factor, steps, result.' })
  lineage(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.calculations.lineage(actor.organizationId!, id);
  }

  @Post(':id/reproduce')
  @RequirePermission('calculation.read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-run the engine on the stored inputs and confirm the result matches.',
  })
  reproduce(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.calculations.reproduce(actor.organizationId!, id);
  }

  @Post(':id/recompute')
  @RequirePermission('calculation.run')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Re-select the factor and re-run; freezes the old row, chains a new one.',
  })
  recompute(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.calculations.recompute(actor.organizationId!, actor.userId, id, this.rid());
  }

  @Post(':id/approve')
  @RequirePermission('calculation.approve')
  @HttpCode(204)
  async approve(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<void> {
    await this.calculations.approve(actor.organizationId!, id, actor.userId, this.rid());
  }
}
