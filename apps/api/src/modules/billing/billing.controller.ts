import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import { loadEnv } from '@trace/config';
import { BILLING_SIGNATURE_HEADER } from '@trace/domain';
import {
  billingPortalUrl,
  getContext,
  getPrisma,
  handleBillingWebhook,
  startCheckout,
  withOrgContext,
  type BillingDeps,
} from '@trace/db';
import { CurrentActor, MfaExempt, Public, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { stripeBillingAdapter } from './stripe-adapter';

const deps: BillingDeps = { adapter: stripeBillingAdapter };

const checkoutSchema = z.object({
  planKey: z.string().trim().min(1).max(64),
  returnPath: z.string().max(512).optional(),
});

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Post('checkout')
  @RequirePermission('billing.manage')
  @ApiOperation({ summary: 'Start a hosted checkout for a plan; returns the redirect URL.' })
  async checkout(
    @Body(new ZodPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ url: string }> {
    const web = loadEnv().WEB_ORIGIN;
    const ret = body.returnPath?.startsWith('/') ? body.returnPath : '/settings/billing';
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      startCheckout(db, deps, {
        organizationId: org,
        planKey: body.planKey,
        actorUserId: actor.userId,
        requestId: this.rid(),
        successUrl: `${web}${ret}?billing=success`,
        cancelUrl: `${web}${ret}?billing=cancelled`,
      }),
    );
  }

  @Get('portal')
  @RequirePermission('billing.manage')
  @ApiOperation({ summary: 'Open the provider billing portal; returns the redirect URL.' })
  async portal(
    @Query('returnPath') returnPath: string | undefined,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ url: string }> {
    const web = loadEnv().WEB_ORIGIN;
    const ret = returnPath?.startsWith('/') ? returnPath : '/settings/billing';
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      billingPortalUrl(db, deps, { organizationId: org, returnUrl: `${web}${ret}` }),
    );
  }

  @Post('webhook/:orgSlug')
  @Public()
  @MfaExempt()
  @ApiExcludeEndpoint()
  async webhook(
    @Param('orgSlug') slug: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: boolean; type: string; handled: boolean; duplicate: boolean }> {
    const header = req.headers[BILLING_SIGNATURE_HEADER];
    const signatureHeader = Array.isArray(header) ? (header[0] ?? '') : (header ?? '');
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    if (!signatureHeader) {
      throw AppError.unauthenticated('billing.bad_signature', 'Missing billing signature header.');
    }
    const result = await handleBillingWebhook(getPrisma(), {
      orgSlug: slug,
      signatureHeader,
      rawBody,
      requestId: this.rid(),
    });
    return {
      received: true,
      type: result.type,
      handled: result.handled,
      duplicate: result.duplicate,
    };
  }
}
