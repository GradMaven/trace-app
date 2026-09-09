import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@trace/shared';
import type { RequestWithContext } from './request-context';
import type { AuthenticatedActor } from './auth.guard';
import { PUBLIC_KEY } from './decorators';

export const CSRF_COOKIE = 'trace_csrf';
const CSRF_HEADER = 'x-trace-csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check for cookie-authenticated mutations (docs/security.md).
 * The web client mirrors the `trace_csrf` cookie into the `x-trace-csrf` header;
 * a cross-site form post cannot read the cookie to do so. `@Public()` routes
 * (magic-link request/verify) are exempt — they carry no session cookie.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();
    if (SAFE_METHODS.has(req.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // API-key requests carry no cookie, so CSRF (a cookie-confusion defense)
    // does not apply — they authenticate with a bearer credential instead.
    if (req.actor?.viaApiKeyId) return true;

    const cookie = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER];
    const headerValue = Array.isArray(header) ? header[0] : header;

    if (!cookie || !headerValue || cookie !== headerValue) {
      throw new AppError({
        errorClass: 'forbidden',
        code: 'csrf.invalid',
        message: 'Missing or invalid CSRF token.',
      });
    }
    return true;
  }
}
