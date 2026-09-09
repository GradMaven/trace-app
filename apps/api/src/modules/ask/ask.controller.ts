import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { askHistory, askQueryById, getContext, runAskQuery, withOrgContext } from '@trace/db';
import type { AIProvider } from '@trace/ai';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { AI_PROVIDER } from '../ai/ai.module';

const askSchema = z.object({ question: z.string().min(3).max(1000) });
const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

@ApiTags('ask')
@Controller('ask')
export class AskController {
  constructor(@Inject(AI_PROVIDER) private readonly aiProvider: AIProvider) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Post()
  @RequirePermission('ask.use')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Ask a natural-language question. Answered only from this workspace’s records, with citations.',
  })
  ask(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(askSchema)) body: z.infer<typeof askSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      runAskQuery(
        db,
        { provider: this.aiProvider },
        {
          organizationId: actor.organizationId!,
          question: body.question,
          actorUserId: actor.userId,
          requestId: this.rid(),
        },
      ),
    );
  }

  @Get('history')
  @RequirePermission('ask.use')
  history(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(historyQuerySchema)) query: z.infer<typeof historyQuerySchema>,
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      askHistory(db, actor.organizationId!, query.limit),
    );
  }

  @Get(':id')
  @RequirePermission('ask.use')
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      askQueryById(db, actor.organizationId!, id),
    );
  }
}
