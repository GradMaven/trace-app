import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@trace/shared';
import { ENFORCED_METRICS, isUsageMetric, type UsageMetric } from '@trace/domain';
import { checkQuota, withOrgContext } from '@trace/db';
import type { RequestWithContext } from './request-context';
import type { AuthenticatedActor } from './auth.guard';
import { METERED_KEY } from './decorators';

/**
 * Enforces plan quotas for `@Metered(metric)` routes whose metric is in
 * `ENFORCED_METRICS`. An organization at or over its monthly quota gets
 * `429 quota.exceeded`. Non-enforced metered routes pass through (the increment
 * still happens in the interceptor).
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metric = this.reflector.getAllAndOverride<string>(METERED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metric || !isUsageMetric(metric) || !ENFORCED_METRICS.includes(metric as UsageMetric)) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();
    const orgId = req.actor?.organizationId;
    if (!orgId) return true;

    const check = await withOrgContext(orgId, (db) => checkQuota(db, orgId, metric as UsageMetric));
    if (!check.allowed) {
      throw AppError.rateLimited(
        'quota.exceeded',
        `Monthly ${metric} quota reached (${check.used}/${check.quota}). Upgrade the plan to continue.`,
      );
    }
    return true;
  }
}
