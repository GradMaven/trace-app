'use client';

import { API_BASE, parseResult, type ApiResult } from './api';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

/** Client-side API call. Sends cookies and mirrors the CSRF cookie into a header. */
export async function clientFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const csrf = readCookie('trace_csrf');
  const orgId = readCookie('trace_active_org');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(csrf ? { 'x-trace-csrf': csrf } : {}),
      ...(orgId ? { 'x-organization-id': orgId } : {}),
      ...(init.headers ?? {}),
    },
  });
  return parseResult<T>(res);
}
