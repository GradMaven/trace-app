import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@trace/shared';
import type { RequestWithContext } from './request-context';
import type { AuthenticatedActor } from './auth.guard';

export const PUBLIC_KEY = 'trace:public';
/** Marks a route as not requiring an authenticated session. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

export const METERED_KEY = 'trace:metered';
/**
 * Records a usage-metric increment for this route on a 2xx response and, for the
 * enforced metrics, blocks the request with `429 quota.exceeded` when the
 * active organization is over its plan quota (Phase 13c).
 */
export const Metered = (metric: string): MethodDecorator & ClassDecorator =>
  SetMetadata(METERED_KEY, metric);

export const MFA_EXEMPT_KEY = 'trace:mfa-exempt';
/**
 * Allows an authenticated-but-not-yet-MFA-verified session to reach this route
 * (the `/me` bootstrap and the MFA challenge / enrolment endpoints). Every other
 * route is blocked with `auth.mfa_required` until the session passes MFA.
 */
export const MfaExempt = (): MethodDecorator & ClassDecorator => SetMetadata(MFA_EXEMPT_KEY, true);

export const PERMISSIONS_KEY = 'trace:permissions';
/** Requires the actor to hold every listed permission in the active organization. */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Injects the authenticated actor (throws if the route is public and unauthenticated). */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedActor | undefined => {
    const req = ctx
      .switchToHttp()
      .getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();
    return req.actor;
  },
);
