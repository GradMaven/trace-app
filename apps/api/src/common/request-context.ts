import { randomUUID, createHash } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { runWithContext, type RequestContext } from '@trace/db';
import type { NextFunction, Request, Response } from 'express';

/**
 * Establishes the ambient RequestContext for every HTTP request (see
 * docs/architecture.md — "Request context"). The actor and organization are
 * filled in later by the AuthGuard once the session is resolved; this middleware
 * only seeds the request id and locale and opens the ALS scope.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string | undefined)?.slice(0, 200) ?? `req_${randomUUID()}`;
    res.setHeader('x-request-id', requestId);

    const ctx: MutableRequestContext = {
      requestId,
      organizationId: null,
      userId: null,
      permissions: [],
      locale: parseLocale(req.headers['accept-language']),
    };
    (req as RequestWithContext).traceContext = ctx;

    runWithContext(ctx, () => next());
  }
}

export type MutableRequestContext = {
  -readonly [K in keyof RequestContext]: RequestContext[K];
};

export interface RequestWithContext extends Request {
  traceContext: MutableRequestContext;
}

function parseLocale(header: string | undefined): string {
  if (!header) return 'en';
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim();
  return first && first.length <= 12 ? first : 'en';
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
