import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { isAppError } from '@trace/shared';
import { PermissionsGuard } from './permissions.guard';

function contextWith(actor: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ actor }) }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(value: unknown): Reflector {
  return { getAllAndOverride: () => value } as unknown as Reflector;
}

describe('PermissionsGuard', () => {
  it('allows routes with no permission requirement', () => {
    const guard = new PermissionsGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it('rejects when the actor lacks the required permission', () => {
    const guard = new PermissionsGuard(reflectorReturning(['member.invite']));
    try {
      guard.canActivate(
        contextWith({ organizationId: 'org', permissions: ['member.read'] }),
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isAppError(err) && err.httpStatus).toBe(403);
      expect(isAppError(err) && err.code).toBe('auth.missing_permission');
    }
  });

  it('rejects when there is no active organization', () => {
    const guard = new PermissionsGuard(reflectorReturning(['member.read']));
    try {
      guard.canActivate(contextWith({ organizationId: null, permissions: [] }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(isAppError(err) && err.code).toBe('auth.no_active_organization');
    }
  });

  it('allows when the actor holds every required permission', () => {
    const guard = new PermissionsGuard(reflectorReturning(['member.read', 'role.read']));
    expect(
      guard.canActivate(
        contextWith({ organizationId: 'org', permissions: ['member.read', 'role.read', 'audit.read'] }),
      ),
    ).toBe(true);
  });
});
