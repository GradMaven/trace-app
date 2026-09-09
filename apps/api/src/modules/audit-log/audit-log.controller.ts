import { Controller, Get, Header, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { paginationQuerySchema, type Page } from '@trace/shared';
import {
  exportAuditLog,
  queryAuditLog,
  verifyAuditChain,
  withOrgContext,
  type AuditQueryRow,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const filterSchema = paginationQuerySchema.extend({
  action: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
  resourceType: z.string().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
const exportFilterSchema = filterSchema.omit({ limit: true, cursor: true });

@ApiTags('audit-log')
@Controller('audit-log')
export class AuditLogController {
  @Get()
  @RequirePermission('auditlog.read')
  @ApiOperation({
    summary:
      'Read the immutable activity log (filterable by action prefix, actor, resource, date).',
  })
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(filterSchema)) q: z.infer<typeof filterSchema>,
  ): Promise<Page<AuditQueryRow>> {
    return withOrgContext(actor.organizationId!, (db) =>
      queryAuditLog(
        db,
        actor.organizationId!,
        {
          actionPrefix: q.action,
          actorId: q.actorId,
          resourceType: q.resourceType,
          from: q.from,
          to: q.to,
        },
        { limit: q.limit, cursor: q.cursor },
      ),
    );
  }

  @Get('export')
  @RequirePermission('auditlog.read')
  @Header('content-type', 'application/x-ndjson; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="trace-audit-log.ndjson"')
  @ApiOperation({ summary: 'Bulk export of the filtered activity log as newline-delimited JSON.' })
  async export(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(exportFilterSchema)) q: z.infer<typeof exportFilterSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const result = await withOrgContext(actor.organizationId!, (db) =>
      exportAuditLog(db, actor.organizationId!, {
        actionPrefix: q.action,
        actorId: q.actorId,
        resourceType: q.resourceType,
        from: q.from,
        to: q.to,
      }),
    );
    res.setHeader('x-trace-rows', String(result.rows));
    if (result.truncated) res.setHeader('x-trace-truncated', 'true');
    return result.ndjson;
  }

  @Post('verify')
  @RequirePermission('auditlog.read')
  @ApiOperation({ summary: 'Recompute the hash chain and report the first break, if any.' })
  verify(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ intact: boolean; brokenAt: number; count: number }> {
    return withOrgContext(actor.organizationId!, (db) =>
      verifyAuditChain(db, actor.organizationId!),
    );
  }
}
