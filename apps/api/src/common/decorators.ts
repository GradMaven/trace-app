import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@trace/shared';
import type { RequestWithContext } from './request-context';
import type { AuthenticatedActor } from './auth.guard';

export const PUBLIC_KEY = 'trace:public';
/** Marks a route as not requiring an authenticated session. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'trace:permissions';
/** Requires the actor to hold every listed permission in the active organization. */
export const RequirePermission = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

/** Injects the authenticated actor (throws if the route is public and unauthenticated). */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedActor | undefined => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();
    return req.actor;
  },
);
