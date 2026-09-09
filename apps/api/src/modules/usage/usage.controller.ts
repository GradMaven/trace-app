import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PLAN_TIERS } from '@trace/domain';
import {
  currentUsage,
  getContext,
  setPlan,
  withOrgContext,
  type CurrentUsage,
  type SubscriptionView,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const planSchema = z.object({
  planKey: z.enum(PLAN_TIERS.map((p) => p.key) as [string, ...string[]]),
});

@ApiTags('usage')
@Controller('usage')
export class UsageController {
  @Get()
  @RequirePermission('usage.read')
  @ApiOperation({ summary: 'Current-period usage vs the plan quota for every metered metric.' })
  get(@CurrentActor() actor: AuthenticatedActor): Promise<CurrentUsage> {
    return withOrgContext(actor.organizationId!, (db) => currentUsage(db, actor.organizationId!));
  }

  @Get('plans')
  @RequirePermission('usage.read')
  @ApiOperation({ summary: 'The plan catalogue (name + per-metric quotas).' })
  plans(): typeof PLAN_TIERS {
    return PLAN_TIERS;
  }

  @Put('plan')
  @RequirePermission('billing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign a billing plan to the organization (no payment integration).' })
  setPlan(
    @Body(new ZodPipe(planSchema)) body: z.infer<typeof planSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<SubscriptionView> {
    const requestId = getContext()?.requestId ?? 'unknown';
    return withOrgContext(actor.organizationId!, (db) =>
      setPlan(db, {
        organizationId: actor.organizationId!,
        planKey: body.planKey,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }
}
