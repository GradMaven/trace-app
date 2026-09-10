import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { loadEnv } from '@trace/config';
import { BILLING_PROVIDERS, PLAN_TIERS } from '@trace/domain';
import {
  billingOverview,
  deleteBillingConfig,
  getContext,
  getPrisma,
  rotateBillingWebhookSecret,
  upsertBillingConfig,
  withOrgContext,
  type BillingOverview,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const configSchema = z.object({
  provider: z.enum(BILLING_PROVIDERS).default('stripe'),
  enabled: z.boolean(),
  publishableKey: z.string().max(512).optional().nullable(),
  secretKey: z.string().min(1).max(512).optional().nullable(),
  webhookSecret: z.string().max(512).optional().nullable(),
  priceToPlan: z.record(z.string().max(256), z.string().max(64)).default({}),
});

@ApiTags('billing')
@Controller('settings/billing')
@RequirePermission('billing.manage')
export class BillingConfigController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @ApiOperation({ summary: 'Billing config (no secrets), the current subscription, plans, and the webhook URL.' })
  async get(@CurrentActor() actor: AuthenticatedActor): Promise<
    BillingOverview & {
      webhookUrl: string;
      plans: typeof PLAN_TIERS;
    }
  > {
    const env = loadEnv();
    const org = actor.organizationId!;
    const o = await getPrisma().organization.findUniqueOrThrow({
      where: { id: org },
      select: { slug: true },
    });
    const overview = await withOrgContext(org, (db) => billingOverview(db, org));
    return {
      ...overview,
      plans: PLAN_TIERS,
      webhookUrl: `${env.API_PUBLIC_URL}/api/v1/billing/webhook/${o.slug}`,
    };
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Create or update the billing-provider connection.' })
  async put(
    @Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ webhookSecret?: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      upsertBillingConfig(db, {
        organizationId: actor.organizationId!,
        config: body,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Post('webhook-secret')
  @ApiOperation({ summary: 'Issue a fresh webhook signing secret (shown once).' })
  async rotateSecret(@CurrentActor() actor: AuthenticatedActor): Promise<{ webhookSecret: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      rotateBillingWebhookSecret(db, {
        organizationId: actor.organizationId!,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the billing-provider connection (the plan is unchanged).' })
  async remove(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      deleteBillingConfig(db, {
        organizationId: actor.organizationId!,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
