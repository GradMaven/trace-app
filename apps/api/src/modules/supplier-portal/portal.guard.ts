import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AppError } from '@trace/shared';
import type { RequestWithContext } from '../../common/request-context';
import type { AuthenticatedActor } from '../../common/auth.guard';

/**
 * Guards the supplier portal: the actor must be an active supplier-portal user
 * (`portal.access` + a `supplierId` on the membership). Runs after the global
 * AuthGuard, which has already populated `req.actor`.
 */
@Injectable()
export class PortalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();
    const actor = req.actor;
    if (!actor) throw AppError.unauthenticated();
    if (!actor.organizationId || !actor.supplierId || !actor.permissions.includes('portal.access')) {
      throw AppError.forbidden('portal.forbidden', 'This area is for supplier-portal users.');
    }
    return true;
  }
}
