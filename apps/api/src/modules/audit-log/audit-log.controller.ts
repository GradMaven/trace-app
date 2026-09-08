import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { paginationQuerySchema, type Page } from '@trace/shared';
import { verifyAuditChain, withOrgContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

interface AuditEntryView {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  createdAt: string;
  hash: string;
  prevHash: string;
}

@ApiTags('audit-log')
@Controller('audit-log')
export class AuditLogController {
  @Get()
  @RequirePermission('auditlog.read')
  @ApiOperation({ summary: 'Read the immutable activity log for the active organization.' })
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(paginationQuerySchema)) query: { limit: number; cursor?: string },
  ): Promise<Page<AuditEntryView>> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.auditLog.findMany({
        where: { organizationId: actor.organizationId! },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        data: pageRows.map((r) => ({
          id: r.id,
          actorId: r.actorId,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          requestId: r.requestId,
          createdAt: r.createdAt.toISOString(),
          hash: r.hash,
          prevHash: r.prevHash,
        })),
        ...(hasMore ? { nextCursor: pageRows[pageRows.length - 1]!.id } : {}),
      };
    });
  }

  @Post('verify')
  @RequirePermission('auditlog.read')
  @ApiOperation({ summary: 'Recompute the hash chain and report the first break, if any.' })
  async verify(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ intact: boolean; brokenAt: number; count: number }> {
    return withOrgContext(actor.organizationId!, (db) =>
      verifyAuditChain(db, actor.organizationId!),
    );
  }
}
