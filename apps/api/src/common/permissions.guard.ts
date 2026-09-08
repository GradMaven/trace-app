import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, type Permission } from '@trace/shared';
import type { RequestWithContext } from './request-context';
import type { AuthenticatedActor } from './auth.guard';
import { PERMISSIONS_KEY } from './decorators';

/**
 * Enforces `@RequirePermission(...)`. Deny by default: a route that declares a
 * permission requirement with no active organization / no permission is 403.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();
    const actor = req.actor;

    if (!actor) throw AppError.unauthenticated();
    if (!actor.organizationId) {
      throw AppError.forbidden(
        'auth.no_active_organization',
        'Select an organization before performing this action.',
      );
    }

    const held = new Set(actor.permissions);
    const missing = required.filter((p) => !held.has(p));
    if (missing.length > 0) {
      throw AppError.forbidden(
        'auth.missing_permission',
        `Missing permission: ${missing.join(', ')}.`,
      );
    }
    return true;
  }
}
