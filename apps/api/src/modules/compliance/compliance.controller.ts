import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CONTROL_STATUS } from '@trace/shared';
import {
  complianceGaps,
  complianceOverview,
  confirmMapping,
  disclosureDetail,
  getContext,
  listRuleStoreVersions,
  loadRuleStore,
  runComplianceEvaluation,
  upsertControl,
  withOrgContext,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const DEFAULT_VERSION = 'esrs@2026.1';

const versionQuerySchema = z.object({ version: z.string().max(60).default(DEFAULT_VERSION) });
const loadSchema = z.object({ version: z.string().max(60).default(DEFAULT_VERSION) });
const evaluateSchema = z.object({
  version: z.string().max(60).default(DEFAULT_VERSION),
  reportingPeriod: z.string().max(60).optional(),
});
const confirmSchema = z.object({ confirm: z.boolean(), note: z.string().max(2000).optional() });
const controlSchema = z.object({
  key: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  requirementCode: z.string().max(40).optional(),
  version: z.string().max(60).default(DEFAULT_VERSION),
  owner: z.string().max(200).optional(),
  status: z.enum(CONTROL_STATUS as unknown as [string, ...string[]]).optional(),
  note: z.string().max(2000).optional(),
});

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('rule-stores')
  @RequirePermission('compliance.read')
  @ApiOperation({ summary: 'Available rule-store versions and which are loaded for this tenant.' })
  ruleStores(@CurrentActor() actor: AuthenticatedActor): Promise<unknown> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const loaded = await db.regulation.findMany({
        select: { key: true, name: true, ruleStoreVersion: true, loadedAt: true },
        orderBy: { ruleStoreVersion: 'asc' },
      });
      return {
        available: listRuleStoreVersions(),
        loaded: loaded.map((r) => ({
          key: r.key,
          name: r.name,
          version: r.ruleStoreVersion,
          loadedAt: r.loadedAt.toISOString(),
        })),
      };
    });
  }

  @Post('rule-stores/load')
  @RequirePermission('compliance.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Load (or refresh) a rule-store version into the tenant workspace.' })
  load(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(loadSchema)) body: z.infer<typeof loadSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) => loadRuleStore(db, body.version));
  }

  @Get('overview')
  @RequirePermission('compliance.read')
  @ApiOperation({
    summary: 'Regulation → requirements → disclosures with objective status + readiness.',
  })
  overview(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(versionQuerySchema)) query: z.infer<typeof versionQuerySchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      complianceOverview(db, actor.organizationId!, query.version),
    );
  }

  @Post('evaluate')
  @RequirePermission('compliance.manage')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Run the mapping engine: requirement → datapoint → calculation → evidence.',
  })
  evaluate(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(evaluateSchema)) body: z.infer<typeof evaluateSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      runComplianceEvaluation(db, {
        organizationId: actor.organizationId!,
        ruleStoreVersion: body.version,
        reportingPeriod: body.reportingPeriod,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('gaps')
  @RequirePermission('compliance.read')
  @ApiOperation({
    summary: 'Required datapoints that are not_started / data_available / review_required.',
  })
  gaps(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(versionQuerySchema)) query: z.infer<typeof versionQuerySchema>,
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      complianceGaps(db, actor.organizationId!, query.version),
    );
  }

  @Get('runs')
  @RequirePermission('compliance.read')
  @ApiOperation({ summary: 'Compliance evaluation run history.' })
  runs(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(versionQuerySchema)) query: z.infer<typeof versionQuerySchema>,
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.complianceRun.findMany({
        where: { organizationId: actor.organizationId!, ruleStoreVersion: query.version },
        orderBy: { startedAt: 'desc' },
        take: 20,
      });
      return rows.map((r) => ({
        id: r.id,
        reportingPeriod: r.reportingPeriod,
        disclosuresEvaluated: r.disclosuresEvaluated,
        requiredDatapoints: r.requiredDatapoints,
        mappingsWritten: r.mappingsWritten,
        readinessPct: Number(r.readinessPct),
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        durationMs: r.durationMs,
      }));
    });
  }

  @Get('disclosures/:id')
  @RequirePermission('compliance.read')
  @ApiOperation({
    summary:
      'The "why" behind a disclosure status: required datapoints, mappings, evidence, controls.',
  })
  disclosure(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      disclosureDetail(db, actor.organizationId!, id),
    );
  }

  @Post('mappings/:id/confirm')
  @RequirePermission('compliance.manage')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm (or un-confirm) a suggested mapping. A human decision, recorded.',
  })
  confirm(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(confirmSchema)) body: z.infer<typeof confirmSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      confirmMapping(db, {
        organizationId: actor.organizationId!,
        mappingId: id,
        confirm: body.confirm,
        note: body.note,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('controls')
  @RequirePermission('compliance.read')
  @ApiOperation({ summary: 'Organization-level controls expected for the loaded requirements.' })
  controls(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(versionQuerySchema)) query: z.infer<typeof versionQuerySchema>,
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.complianceControl.findMany({
        where: { organizationId: actor.organizationId!, ruleStoreVersion: query.version },
        orderBy: { key: 'asc' },
      });
      return rows.map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        description: c.description,
        owner: c.owner,
        status: c.status,
        lastTestedAt: c.lastTestedAt ? c.lastTestedAt.toISOString() : null,
        note: c.note,
      }));
    });
  }

  @Put('controls')
  @RequirePermission('compliance.manage')
  @ApiOperation({ summary: 'Create or update an organization control.' })
  putControl(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(controlSchema)) body: z.infer<typeof controlSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      upsertControl(db, {
        organizationId: actor.organizationId!,
        key: body.key,
        name: body.name,
        description: body.description,
        requirementCode: body.requirementCode,
        ruleStoreVersion: body.version,
        owner: body.owner,
        status: body.status,
        note: body.note,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
