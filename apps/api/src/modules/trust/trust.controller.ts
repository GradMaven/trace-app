import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { TRUST_BAND, paginationQuerySchema, type Page } from '@trace/shared';
import { datapointTrust, getContext, scoreDatapointTrust, withOrgContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const listQuerySchema = paginationQuerySchema.extend({
  band: z.enum(TRUST_BAND as unknown as [string, ...string[]]).optional(),
  metricKey: z.string().max(120).optional(),
  subjectType: z.string().max(40).optional(),
  reportingPeriod: z.string().max(60).optional(),
});

interface TrustScoreRow {
  id: string;
  datapointId: string;
  metricKey: string;
  subjectType: string;
  subjectId: string;
  reportingPeriod: string | null;
  value: number;
  band: string;
  modelVersion: string;
  computedAt: string;
}

@ApiTags('trust')
@Controller('trust')
export class TrustController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('scores')
  @RequirePermission('trust.read')
  @ApiOperation({ summary: 'Current Trust Scores (one per datapoint), lowest first.' })
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Page<TrustScoreRow>> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.trustScore.findMany({
        where: {
          organizationId: actor.organizationId!,
          supersededBy: { none: {} },
          ...(query.band ? { band: query.band as never } : {}),
          ...(query.metricKey ? { metricKey: query.metricKey } : {}),
          ...(query.subjectType ? { subjectType: query.subjectType } : {}),
          ...(query.reportingPeriod ? { reportingPeriod: query.reportingPeriod } : {}),
        },
        orderBy: [{ value: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const data: TrustScoreRow[] = (hasMore ? rows.slice(0, query.limit) : rows).map((s) => ({
        id: s.id,
        datapointId: s.datapointId,
        metricKey: s.metricKey,
        subjectType: s.subjectType,
        subjectId: s.subjectId,
        reportingPeriod: s.reportingPeriod,
        value: s.value,
        band: s.band,
        modelVersion: s.modelVersion,
        computedAt: s.computedAt.toISOString(),
      }));
      return hasMore ? { data, nextCursor: data[data.length - 1]!.id } : { data };
    });
  }

  @Get('scores/:datapointId')
  @RequirePermission('trust.read')
  @ApiOperation({
    summary: 'A datapoint Trust Score with its additive breakdown, issues and anomalies.',
  })
  detail(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('datapointId') datapointId: string,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      datapointTrust(db, actor.organizationId!, datapointId),
    );
  }

  @Post('scores/:datapointId/recompute')
  @RequirePermission('trust.run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recompute one datapoint Trust Score from its current context.' })
  recompute(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('datapointId') datapointId: string,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      scoreDatapointTrust(db, {
        organizationId: actor.organizationId!,
        datapointId,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
