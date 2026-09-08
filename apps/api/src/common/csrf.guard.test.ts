import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { isAppError } from '@trace/shared';
import { CsrfGuard } from './csrf.guard';

function ctx(method: string, cookies: Record<string, string>, headers: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ method, cookies, headers }) }),
  } as unknown as ExecutionContext;
}

const notPublic = { getAllAndOverride: () => false } as unknown as Reflector;
const isPublic = { getAllAndOverride: () => true } as unknown as Reflector;

describe('CsrfGuard', () => {
  it('lets safe methods through', () => {
    expect(new CsrfGuard(notPublic).canActivate(ctx('GET', {}, {}))).toBe(true);
  });

  it('lets public routes through', () => {
    expect(new CsrfGuard(isPublic).canActivate(ctx('POST', {}, {}))).toBe(true);
  });

  it('rejects a mutation with no CSRF token', () => {
    try {
      new CsrfGuard(notPublic).canActivate(ctx('POST', {}, {}));
      expect.unreachable();
    } catch (err) {
      expect(isAppError(err) && err.code).toBe('csrf.invalid');
    }
  });

  it('rejects a mismatched double-submit token', () => {
    expect(() =>
      new CsrfGuard(notPublic).canActivate(
        ctx('POST', { trace_csrf: 'a' }, { 'x-trace-csrf': 'b' }),
      ),
    ).toThrow();
  });

  it('accepts a matching double-submit token', () => {
    expect(
      new CsrfGuard(notPublic).canActivate(
        ctx('POST', { trace_csrf: 'match' }, { 'x-trace-csrf': 'match' }),
      ),
    ).toBe(true);
  });
});
