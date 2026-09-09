import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  AUDIT_STATUS,
  FINDING_SEVERITY,
  FINDING_STATUS,
  paginationQuerySchema,
  type Page,
} from '@trace/shared';
import {
  auditReadiness,
  createAudit,
  createFinding,
  evidenceChain,
  evidenceReviewList,
  getContext,
  runAuditSimulation,
  updateAudit,
  updateFinding,
  withOrgContext,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const enumValues = <T extends readonly string[]>(e: T) => e as unknown as [string, ...string[]];
const DEFAULT_VERSION = 'esrs@2026.1';

const simulateSchema = z.object({
  auditId: z.string().uuid().optional(),
  reportingPeriod: z.string().max(60).optional(),
  version: z.string().max(60).default(DEFAULT_VERSION),
});

const createAuditSchema = z.object({
  name: z.string().min(1).max(200),
  scope: z.string().max(2000).optional(),
  reportingPeriod: z.string().max(60).optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  leadAuditorUserId: z.string().uuid().optional(),
  externalAuditor: z.string().max(200).optional(),
  ruleStoreVersion: z.string().max(60).optional(),
  notes: z.string().max(4000).optional(),
});

const patchAuditSchema = z.object({
  status: z.enum(enumValues(AUDIT_STATUS)).optional(),
  name: z.string().min(1).max(200).optional(),
  scope: z.string().max(2000).optional(),
  externalAuditor: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
});

const createFindingSchema = z.object({
  auditId: z.string().uuid().optional(),
  severity: z.enum(enumValues(FINDING_SEVERITY)),
  subjectType: z.string().min(1).max(60),
  subjectId: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  detail: z.string().min(1).max(4000),
  recommendation: z.string().max(4000).optional(),
  assignedToUserId: z.string().uuid().optional(),
  dueOn: z.string().date().optional(),
});

const patchFindingSchema = z.object({
  status: z.enum(enumValues(FINDING_STATUS)).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  dueOn: z.string().date().nullable().optional(),
  recommendation: z.string().max(4000).optional(),
  note: z.string().max(4000).optional(),
});

const findingsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(enumValues(FINDING_STATUS)).optional(),
  severity: z.enum(enumValues(FINDING_SEVERITY)).optional(),
  auditId: z.string().uuid().optional(),
  source: z.enum(['manual', 'simulation']).optional(),
});

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('readiness')
  @RequirePermission('audit.read')
  @ApiOperation({
    summary: 'Latest audit-readiness simulation, open findings by severity, recent packages.',
  })
  readiness(@CurrentActor() actor: AuthenticatedActor): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) => auditReadiness(db, actor.organizationId!));
  }

  @Post('simulate')
  @RequirePermission('audit.manage')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Run the audit-readiness simulation: scores the org and refreshes findings.',
  })
  simulate(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(simulateSchema)) body: z.infer<typeof simulateSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      runAuditSimulation(db, {
        organizationId: actor.organizationId!,
        auditId: body.auditId,
        reportingPeriod: body.reportingPeriod,
        ruleStoreVersion: body.version,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('simulations')
  @RequirePermission('audit.read')
  simulations(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(paginationQuerySchema)) query: z.infer<typeof paginationQuerySchema>,
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.auditSimulationRun.findMany({
        where: { organizationId: actor.organizationId! },
        orderBy: { startedAt: 'desc' },
        take: query.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        reportingPeriod: r.reportingPeriod,
        ruleStoreVersion: r.ruleStoreVersion,
        readinessValue: r.readinessValue,
        readinessBand: r.readinessBand,
        modelVersion: r.modelVersion,
        issueCounts: r.issueCounts,
        findingsOpened: r.findingsOpened,
        findingsResolved: r.findingsResolved,
        findingsOpen: r.findingsOpen,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        durationMs: r.durationMs,
      }));
    });
  }

  @Get('audits')
  @RequirePermission('audit.read')
  audits(@CurrentActor() actor: AuthenticatedActor): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.audit.findMany({
        where: { organizationId: actor.organizationId! },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { findings: true } } },
      });
      return rows.map((a) => ({
        id: a.id,
        name: a.name,
        scope: a.scope,
        reportingPeriod: a.reportingPeriod,
        status: a.status,
        externalAuditor: a.externalAuditor,
        leadAuditorUserId: a.leadAuditorUserId,
        ruleStoreVersion: a.ruleStoreVersion,
        findingCount: a._count.findings,
        createdAt: a.createdAt.toISOString(),
        closedAt: a.closedAt ? a.closedAt.toISOString() : null,
      }));
    });
  }

  @Post('audits')
  @RequirePermission('audit.manage')
  @HttpCode(201)
  createAudit(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createAuditSchema)) body: z.infer<typeof createAuditSchema>,
  ): Promise<{ id: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      createAudit(db, {
        organizationId: actor.organizationId!,
        ...body,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Patch('audits/:id')
  @RequirePermission('audit.manage')
  patchAudit(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(patchAuditSchema)) body: z.infer<typeof patchAuditSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      updateAudit(db, {
        organizationId: actor.organizationId!,
        auditId: id,
        status: body.status as never,
        name: body.name,
        scope: body.scope,
        externalAuditor: body.externalAuditor,
        notes: body.notes,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('findings')
  @RequirePermission('audit.read')
  findings(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(findingsQuerySchema)) query: z.infer<typeof findingsQuerySchema>,
  ): Promise<Page<Record<string, unknown>>> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.auditFinding.findMany({
        where: {
          organizationId: actor.organizationId!,
          ...(query.status ? { status: query.status as never } : {}),
          ...(query.severity ? { severity: query.severity as never } : {}),
          ...(query.auditId ? { auditId: query.auditId } : {}),
          ...(query.source ? { source: query.source as never } : {}),
        },
        orderBy: [{ status: 'asc' }, { severity: 'asc' }, { lastSeenAt: 'desc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const data = (hasMore ? rows.slice(0, query.limit) : rows).map((f) => ({
        id: f.id,
        source: f.source,
        severity: f.severity,
        kind: f.kind,
        status: f.status,
        subjectType: f.subjectType,
        subjectId: f.subjectId,
        title: f.title,
        detail: f.detail,
        recommendation: f.recommendation,
        auditId: f.auditId,
        assignedToUserId: f.assignedToUserId,
        dueOn: f.dueOn ? f.dueOn.toISOString().slice(0, 10) : null,
        firstDetectedAt: f.firstDetectedAt.toISOString(),
        lastSeenAt: f.lastSeenAt.toISOString(),
        resolvedAt: f.resolvedAt ? f.resolvedAt.toISOString() : null,
        resolutionNote: f.resolutionNote,
      }));
      return hasMore ? { data, nextCursor: data[data.length - 1]!.id } : { data };
    });
  }

  @Post('findings')
  @RequirePermission('audit.manage')
  @HttpCode(201)
  createFinding(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createFindingSchema)) body: z.infer<typeof createFindingSchema>,
  ): Promise<{ id: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      createFinding(db, {
        organizationId: actor.organizationId!,
        auditId: body.auditId,
        severity: body.severity as never,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        title: body.title,
        detail: body.detail,
        recommendation: body.recommendation,
        assignedToUserId: body.assignedToUserId,
        dueOn: body.dueOn,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Patch('findings/:id')
  @RequirePermission('audit.manage')
  patchFinding(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(patchFindingSchema)) body: z.infer<typeof patchFindingSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      updateFinding(db, {
        organizationId: actor.organizationId!,
        findingId: id,
        status: body.status as never,
        assignedToUserId: body.assignedToUserId,
        dueOn: body.dueOn,
        recommendation: body.recommendation,
        note: body.note,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('evidence-review')
  @RequirePermission('audit.read')
  @ApiOperation({
    summary:
      'Per-datapoint chain health: evidence verified, calculation reproduces, approved, Trust.',
  })
  evidenceReview(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(z.object({ reportingPeriod: z.string().max(60).optional() })))
    query: { reportingPeriod?: string },
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      evidenceReviewList(db, actor.organizationId!, query.reportingPeriod),
    );
  }

  @Get('evidence-chain/:datapointId')
  @RequirePermission('audit.read')
  @ApiOperation({
    summary:
      'Full evidence chain for one datapoint: calculation → activity → factor → evidence → verifications → Trust → compliance.',
  })
  evidenceChain(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('datapointId') datapointId: string,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      evidenceChain(db, actor.organizationId!, datapointId),
    );
  }
}
