import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import { RETENTION_TARGETS } from '@trace/domain';
import {
  deleteRetentionPolicy,
  getContext,
  listRetentionPolicies,
  listRetentionRuns,
  runRetention,
  upsertRetentionPolicy,
  withOrgContext,
  type RetentionPolicyView,
  type RetentionRunSummary,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const policySchema = z.object({
  ageDays: z.number().int().min(1).max(3650),
  enabled: z.boolean().default(true),
});
const runSchema = z.object({
  mode: z.enum(['dry_run', 'apply']),
  target: z.string().max(60).optional(),
});

@ApiTags('settings')
@Controller('settings/retention')
@RequirePermission('security.manage')
export class RetentionController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('targets')
  @ApiOperation({
    summary: 'The catalogue of retention targets (operational / derived data only).',
  })
  targets(): typeof RETENTION_TARGETS {
    return RETENTION_TARGETS;
  }

  @Get()
  @ApiOperation({ summary: 'Retention policies and recent runs for the organization.' })
  async list(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ policies: RetentionPolicyView[]; runs: Record<string, unknown>[] }> {
    return withOrgContext(actor.organizationId!, async (db) => ({
      policies: await listRetentionPolicies(db, actor.organizationId!),
      runs: await listRetentionRuns(db, actor.organizationId!),
    }));
  }

  @Put(':target')
  @HttpCode(204)
  @ApiOperation({ summary: 'Create or update the retention policy for one target.' })
  async upsert(
    @Param('target') target: string,
    @Body(new ZodPipe(policySchema)) body: z.infer<typeof policySchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      upsertRetentionPolicy(db, {
        organizationId: actor.organizationId!,
        target,
        ageDays: body.ageDays,
        enabled: body.enabled,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete(':target')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the retention policy for one target.' })
  async remove(
    @Param('target') target: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await withOrgContext(actor.organizationId!, async (db) => {
      const existing = await db.retentionPolicy.findUnique({
        where: { organizationId_target: { organizationId: actor.organizationId!, target } },
        select: { id: true },
      });
      if (!existing) throw AppError.notFound('retention.not_found', 'No policy for that target.');
      await deleteRetentionPolicy(db, {
        organizationId: actor.organizationId!,
        policyId: existing.id,
        actorUserId: actor.userId,
        requestId: this.rid(),
      });
    });
  }

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run retention now: dry_run counts what would be purged, apply deletes it.',
  })
  run(
    @Body(new ZodPipe(runSchema)) body: z.infer<typeof runSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<RetentionRunSummary[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      runRetention(db, {
        organizationId: actor.organizationId!,
        target: body.target,
        mode: body.mode,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
