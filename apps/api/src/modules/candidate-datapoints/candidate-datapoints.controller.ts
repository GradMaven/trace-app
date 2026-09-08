import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError, PROVENANCE, paginationQuerySchema, type Page } from '@trace/shared';
import { getContext, promoteCandidate, rejectCandidate, withOrgContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const listQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'promoted', 'rejected']).optional(),
  documentId: z.string().uuid().optional(),
});

const promoteSchema = z.object({
  subjectType: z.enum(['organization', 'business_unit', 'supplier', 'facility', 'product']),
  subjectId: z.string().uuid(),
  provenance: z.enum(PROVENANCE as unknown as [string, ...string[]]).optional(),
  valueNumeric: z.number().optional(),
  valueText: z.string().max(500).optional(),
  unit: z.string().max(40).optional(),
  note: z.string().max(2000).optional(),
});

const rejectSchema = z.object({ note: z.string().max(2000).optional() });

interface CandidateView {
  id: string;
  documentId: string;
  metricKey: string;
  label: string;
  value: string | null;
  unit: string | null;
  reportingPeriod: string | null;
  provenanceGuess: string;
  confidence: string;
  status: string;
  rationale: string | null;
  createdAt: string;
}

@ApiTags('candidate-datapoints')
@Controller('candidate-datapoints')
export class CandidateDatapointsController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @RequirePermission('candidate.read')
  @ApiOperation({ summary: 'The AI extraction review queue.' })
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<Page<CandidateView>> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.candidateDatapoint.findMany({
        where: {
          organizationId: actor.organizationId!,
          ...(query.status ? { status: query.status } : {}),
          ...(query.documentId ? { documentId: query.documentId } : {}),
        },
        orderBy: [{ status: 'asc' }, { confidence: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const data = (hasMore ? rows.slice(0, query.limit) : rows).map(toView);
      return hasMore ? { data, nextCursor: data[data.length - 1]!.id } : { data };
    });
  }

  @Get(':id')
  @RequirePermission('candidate.read')
  @ApiOperation({ summary: 'A candidate with its source spans, AI job, and parsed context.' })
  async get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const c = await db.candidateDatapoint.findFirst({
        where: { id, organizationId: actor.organizationId! },
        include: {
          document: { select: { id: true, filename: true, mime: true } },
        },
      });
      if (!c) throw AppError.notFound('candidate.not_found', 'Candidate not found.');
      const [aiJob, extraction] = await Promise.all([
        c.aiJobId ? db.aiJob.findUnique({ where: { id: c.aiJobId } }) : null,
        db.documentExtraction.findUnique({ where: { documentId: c.documentId } }),
      ]);
      const spans = (c.sourceSpans as Array<{ charStart: number | null; charEnd: number | null; page: number | null; sourceText: string }>) ?? [];
      const parsedText = extraction?.parsedText ?? '';
      const first = spans[0];
      const contextWindow =
        first && first.charStart != null
          ? parsedText.slice(Math.max(0, first.charStart - 400), (first.charEnd ?? first.charStart) + 400)
          : (first?.sourceText ?? null);

      return {
        ...toView(c),
        subjectSuggestion: c.reportingPeriod,
        promotedDatapointId: c.promotedDatapointId,
        reviewNote: c.reviewNote,
        document: c.document,
        sourceSpans: spans,
        contextWindow,
        classification: extraction?.classification ?? null,
        aiJob: aiJob
          ? {
              id: aiJob.id,
              provider: aiJob.provider,
              model: aiJob.model,
              promptVersion: aiJob.promptVersion,
              confidence: aiJob.confidence?.toString() ?? null,
              tokensIn: aiJob.tokensIn,
              tokensOut: aiJob.tokensOut,
              costEur: aiJob.costEur.toString(),
            }
          : null,
      };
    });
  }

  @Post(':id/promote')
  @RequirePermission('candidate.review')
  @HttpCode(201)
  @ApiOperation({ summary: 'Promote a candidate to a Datapoint, backed by evidence from the document.' })
  promote(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(promoteSchema)) body: z.infer<typeof promoteSchema>,
  ): Promise<{ datapointId: string; evidenceId: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      promoteCandidate(db, {
        organizationId: actor.organizationId!,
        candidateId: id,
        actorUserId: actor.userId,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        provenance: body.provenance as never,
        valueNumeric: body.valueNumeric,
        valueText: body.valueText,
        unit: body.unit,
        note: body.note,
        requestId: this.rid(),
      }),
    );
  }

  @Post(':id/reject')
  @RequirePermission('candidate.review')
  @HttpCode(204)
  async reject(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      rejectCandidate(db, {
        organizationId: actor.organizationId!,
        candidateId: id,
        actorUserId: actor.userId,
        note: body.note,
        requestId: this.rid(),
      }),
    );
  }
}

function toView(c: {
  id: string;
  documentId: string;
  metricKey: string;
  label: string;
  valueNumeric: { toString(): string } | null;
  valueText: string | null;
  unit: string | null;
  reportingPeriod: string | null;
  provenanceGuess: string;
  confidence: { toString(): string };
  status: string;
  rationale: string | null;
  createdAt: Date;
}): CandidateView {
  return {
    id: c.id,
    documentId: c.documentId,
    metricKey: c.metricKey,
    label: c.label,
    value: c.valueNumeric?.toString() ?? c.valueText,
    unit: c.unit,
    reportingPeriod: c.reportingPeriod,
    provenanceGuess: c.provenanceGuess,
    confidence: c.confidence.toString(),
    status: c.status,
    rationale: c.rationale,
    createdAt: c.createdAt.toISOString(),
  };
}
