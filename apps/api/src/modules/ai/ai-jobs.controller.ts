import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError, paginationQuerySchema, type Page } from '@trace/shared';
import { withOrgContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const listQuerySchema = paginationQuerySchema.extend({
  capability: z.string().max(40).optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
});

interface AiJobView {
  id: string;
  capability: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: string;
  confidence: string | null;
  tokensIn: number;
  tokensOut: number;
  costEur: string;
  latencyMs: number;
  documentId: string | null;
  reviewerId: string | null;
  createdAt: string;
  completedAt: string | null;
}

@ApiTags('ai-jobs')
@Controller('ai-jobs')
export class AiJobsController {
  @Get()
  @RequirePermission('ai.read')
  @ApiOperation({ summary: 'The AI operation log — every model / stub call, with tokens and cost.' })
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Page<AiJobView>> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.aiJob.findMany({
        where: {
          organizationId: actor.organizationId!,
          ...(query.capability ? { capability: query.capability } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const data = (hasMore ? rows.slice(0, query.limit) : rows).map(toView);
      return hasMore ? { data, nextCursor: data[data.length - 1]!.id } : { data };
    });
  }

  @Get(':id')
  @RequirePermission('ai.read')
  async get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const job = await db.aiJob.findFirst({ where: { id, organizationId: actor.organizationId! } });
      if (!job) throw AppError.notFound('ai_job.not_found', 'AI job not found.');
      return { ...toView(job), promptVersion: job.promptVersion, error: job.error, output: job.output };
    });
  }
}

function toView(j: {
  id: string;
  capability: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: string;
  confidence: { toString(): string } | null;
  tokensIn: number;
  tokensOut: number;
  costEur: { toString(): string };
  latencyMs: number;
  documentId: string | null;
  reviewerId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): AiJobView {
  return {
    id: j.id,
    capability: j.capability,
    provider: j.provider,
    model: j.model,
    promptVersion: j.promptVersion,
    status: j.status,
    confidence: j.confidence?.toString() ?? null,
    tokensIn: j.tokensIn,
    tokensOut: j.tokensOut,
    costEur: j.costEur.toString(),
    latencyMs: j.latencyMs,
    documentId: j.documentId,
    reviewerId: j.reviewerId,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
  };
}
