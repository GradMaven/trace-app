import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';
import { isUsageMetric } from '@trace/domain';
import { getPrisma, recordApiRequest, recordUsage, withOrgContext } from '@trace/db';
import type { RequestWithContext } from './request-context';
import type { AuthenticatedActor } from './auth.guard';
import { METERED_KEY, PUBLIC_KEY } from './decorators';

/**
 * Records usage on a successful response (Phase 13c): one `api_request` for
 * every authenticated request that has an active organization, plus the
 * `@Metered(metric)` increment for decorated routes. Fire-and-forget — never
 * blocks or fails the response.
 */
@Injectable()
export class UsageInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const metric = this.reflector.getAllAndOverride<string>(METERED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();

    return next.handle().pipe(
      tap(() => {
        const orgId = req.actor?.organizationId;
        if (isPublic || !orgId) return;
        const status = http.getResponse<{ statusCode?: number }>().statusCode ?? 200;
        if (status >= 400) return;

        void recordApiRequest(getPrisma(), orgId);

        if (metric && isUsageMetric(metric) && metric !== 'api_request') {
          const route = `${req.method} ${req.route?.path ?? req.path}`;
          void withOrgContext(orgId, (db) =>
            recordUsage(db, {
              organizationId: orgId,
              metric,
              route,
              actorUserId: req.actor?.userId ?? null,
              requestId: req.traceContext.requestId,
            }),
          ).catch(() => undefined);
        }
      }),
    );
  }
}
