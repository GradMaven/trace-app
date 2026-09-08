import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ANOMALY_STATUS,
  DATA_QUALITY_ISSUE_KIND,
  ISSUE_SEVERITY,
  ISSUE_STATUS,
  paginationQuerySchema,
  type Page,
} from '@trace/shared';
import {
  getContext,
  qualitySummary,
  runQualityScan,
  updateAnomalyStatus,
  updateIssueStatus,
  withOrgContext,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const enumValues = <T extends readonly string[]>(e: T) => e as unknown as [string, ...string[]];

const summaryQuerySchema = z.object({ reportingPeriod: z.string().max(60).optional() });

const issuesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(enumValues(ISSUE_STATUS)).optional(),
  severity: z.enum(enumValues(ISSUE_SEVERITY)).optional(),
  kind: z.enum(enumValues(DATA_QUALITY_ISSUE_KIND)).optional(),
  reportingPeriod: z.string().max(60).optional(),
});

const anomaliesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(enumValues(ANOMALY_STATUS)).optional(),
  metricKey: z.string().max(120).optional(),
});

const issuePatchSchema = z.object({
  status: z.enum(enumValues(ISSUE_STATUS)),
  note: z.string().max(2000).optional(),
});

const anomalyPatchSchema = z.object({
  status: z.enum(enumValues(ANOMALY_STATUS)),
  note: z.string().max(2000).optional(),
});

const scanSchema = z.object({ reportingPeriod: z.string().max(60).optional() });

@ApiTags('data-quality')
@Controller('data-quality')
export class DataQualityController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('summary')
  @RequirePermission('trust.read')
  @ApiOperation({
    summary:
      'Trust + data-quality dashboard: average score, bands, open issues, anomalies, last scan.',
  })
  summary(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(summaryQuerySchema)) query: z.infer<typeof summaryQuerySchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      qualitySummary(db, actor.organizationId!, query.reportingPeriod),
    );
  }

  @Get('scans')
  @RequirePermission('trust.read')
  @ApiOperation({ summary: 'Data-quality scan history.' })
  scans(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(paginationQuerySchema)) query: z.infer<typeof paginationQuerySchema>,
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.qualityScan.findMany({
        where: { organizationId: actor.organizationId! },
        orderBy: { startedAt: 'desc' },
        take: query.limit,
      });
      return rows.map((s) => ({
        id: s.id,
        reportingPeriod: s.reportingPeriod,
        datapointsScored: s.datapointsScored,
        avgTrustScore: s.avgTrustScore ? s.avgTrustScore.toString() : null,
        issuesOpened: s.issuesOpened,
        issuesResolved: s.issuesResolved,
        issuesOpen: s.issuesOpen,
        anomaliesFound: s.anomaliesFound,
        modelVersion: s.modelVersion,
        rulesVersion: s.rulesVersion,
        detectorVersion: s.detectorVersion,
        startedAt: s.startedAt.toISOString(),
        completedAt: s.completedAt ? s.completedAt.toISOString() : null,
        durationMs: s.durationMs,
      }));
    });
  }

  @Post('scan')
  @RequirePermission('trust.run')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Run a trust + data-quality scan (optionally scoped to a reporting period).',
  })
  scan(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(scanSchema)) body: z.infer<typeof scanSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      runQualityScan(db, {
        organizationId: actor.organizationId!,
        reportingPeriod: body.reportingPeriod,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('issues')
  @RequirePermission('trust.read')
  @ApiOperation({ summary: 'Data-quality issues.' })
  issues(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(issuesQuerySchema)) query: z.infer<typeof issuesQuerySchema>,
  ): Promise<Page<Record<string, unknown>>> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.dataQualityIssue.findMany({
        where: {
          organizationId: actor.organizationId!,
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.severity ? { severity: query.severity as never } : {}),
          ...(query.kind ? { kind: query.kind as never } : {}),
          ...(query.reportingPeriod ? { reportingPeriod: query.reportingPeriod } : {}),
        },
        orderBy: [{ status: 'asc' }, { severity: 'asc' }, { lastSeenAt: 'desc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const data = (hasMore ? rows.slice(0, query.limit) : rows).map((i) => ({
        id: i.id,
        kind: i.kind,
        severity: i.severity,
        status: i.status,
        subjectType: i.subjectType,
        subjectId: i.subjectId,
        datapointId: i.datapointId,
        metricKey: i.metricKey,
        reportingPeriod: i.reportingPeriod,
        title: i.title,
        detail: i.detail,
        facts: i.facts,
        rulesVersion: i.rulesVersion,
        firstDetectedAt: i.firstDetectedAt.toISOString(),
        lastSeenAt: i.lastSeenAt.toISOString(),
        resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
        resolutionNote: i.resolutionNote,
      }));
      return hasMore ? { data, nextCursor: data[data.length - 1]!.id } : { data };
    });
  }

  @Patch('issues/:id')
  @RequirePermission('quality.manage')
  @ApiOperation({ summary: 'Triage a data-quality issue: acknowledge, resolve, or dismiss.' })
  patchIssue(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(issuePatchSchema)) body: z.infer<typeof issuePatchSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      updateIssueStatus(db, {
        organizationId: actor.organizationId!,
        issueId: id,
        status: body.status as never,
        note: body.note,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('anomalies')
  @RequirePermission('trust.read')
  @ApiOperation({ summary: 'Detected anomalies with candidate explanations.' })
  anomalies(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(anomaliesQuerySchema)) query: z.infer<typeof anomaliesQuerySchema>,
  ): Promise<Page<Record<string, unknown>>> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.anomaly.findMany({
        where: {
          organizationId: actor.organizationId!,
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.metricKey ? { metricKey: query.metricKey } : {}),
        },
        orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const data = (hasMore ? rows.slice(0, query.limit) : rows).map((a) => ({
        id: a.id,
        method: a.method,
        status: a.status,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        datapointId: a.datapointId,
        metricKey: a.metricKey,
        pointKey: a.pointKey,
        reportingPeriod: a.reportingPeriod,
        observedValue: a.observedValue.toString(),
        expectedValue: a.expectedValue.toString(),
        score: a.score.toString(),
        direction: a.direction,
        explanations: a.explanations,
        detectorVersion: a.detectorVersion,
        detectedAt: a.detectedAt.toISOString(),
        lastSeenAt: a.lastSeenAt.toISOString(),
      }));
      return hasMore ? { data, nextCursor: data[data.length - 1]!.id } : { data };
    });
  }

  @Patch('anomalies/:id')
  @RequirePermission('quality.manage')
  @ApiOperation({ summary: 'Triage an anomaly: mark explained or dismissed.' })
  patchAnomaly(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(anomalyPatchSchema)) body: z.infer<typeof anomalyPatchSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      updateAnomalyStatus(db, {
        organizationId: actor.organizationId!,
        anomalyId: id,
        status: body.status as never,
        note: body.note,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
