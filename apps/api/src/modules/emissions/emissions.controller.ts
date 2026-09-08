import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { getContext, inventorySummary, recomputeEmissions, withOrgContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const periodQuerySchema = z.object({ reportingPeriod: z.string().min(2).max(60) });
const recomputeSchema = z.object({ reportingPeriod: z.string().min(2).max(60) });

@ApiTags('emissions')
@Controller('emissions')
export class EmissionsController {
  @Get('summary')
  @RequirePermission('calculation.read')
  @ApiOperation({ summary: 'GHG inventory summary for a reporting period (Scope 1/2/3 + categories).' })
  summary(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(periodQuerySchema)) query: { reportingPeriod: string },
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      inventorySummary(db, actor.organizationId!, query.reportingPeriod),
    );
  }

  @Get()
  @RequirePermission('calculation.read')
  @ApiOperation({ summary: 'Rolled-up emission totals per (scope, category).' })
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(periodQuerySchema)) query: { reportingPeriod: string },
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.emission.findMany({
        where: { organizationId: actor.organizationId!, reportingPeriod: query.reportingPeriod },
        orderBy: [{ scope: 'asc' }, { ghgCategory: 'asc' }],
      });
      return rows.map((e) => ({
        id: e.id,
        scope: e.scope,
        ghgCategory: e.ghgCategory,
        reportingPeriod: e.reportingPeriod,
        valueTco2e: e.valueTco2e.toString(),
        calculationCount: e.calculationCount,
        methodSummary: e.methodSummary,
        computedAt: e.computedAt.toISOString(),
      }));
    });
  }

  @Post('recompute')
  @RequirePermission('calculation.run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rebuild the emission rollup for a period from current calculations.' })
  recompute(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(recomputeSchema)) body: { reportingPeriod: string },
  ): Promise<{ groups: number; total: string }> {
    const requestId = getContext()?.requestId ?? 'unknown';
    return withOrgContext(actor.organizationId!, (db) =>
      recomputeEmissions(db, {
        organizationId: actor.organizationId!,
        reportingPeriod: body.reportingPeriod,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }
}
