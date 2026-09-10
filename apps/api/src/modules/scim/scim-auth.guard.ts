import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AppError } from '@trace/shared';
import { authenticateScim, getPrisma } from '@trace/db';
import type { Request } from 'express';

export interface ScimRequestContext {
  organizationId: string;
  orgSlug: string;
}

/**
 * Authenticates a SCIM request: `Authorization: Bearer <token>` + the `:orgSlug`
 * path param. On success, `req.scim = { organizationId, orgSlug }`. The global
 * `AuthGuard` lets these routes through because they are `@Public()`.
 */
@Injectable()
export class ScimAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { scim?: ScimRequestContext }>();
    const slug = String((req.params as Record<string, string>).orgSlug ?? '').trim();
    const header = req.headers.authorization;
    const raw = Array.isArray(header) ? header[0] : header;
    const token =
      raw && raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
    if (!slug || !token) {
      throw AppError.unauthenticated('scim.unauthorized', 'A SCIM bearer token is required.');
    }
    const { organizationId } = await authenticateScim(getPrisma(), {
      orgSlug: slug,
      bearerToken: token,
    });
    req.scim = { organizationId, orgSlug: slug };
    return true;
  }
}
