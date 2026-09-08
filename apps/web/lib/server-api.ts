import { cookies, headers } from 'next/headers';
import { API_BASE, parseResult, type ApiResult } from './api';

/**
 * Server-side API call from a React Server Component or route handler. Forwards
 * the browser's cookies (session + CSRF) and the active-organization header.
 */
export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const csrf = cookieStore.get('trace_csrf')?.value;
  const orgHeader = (await headers()).get('x-organization-id') ?? undefined;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader,
      ...(csrf ? { 'x-trace-csrf': csrf } : {}),
      ...(orgHeader ? { 'x-organization-id': orgHeader } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  return parseResult<T>(res);
}

export interface Me {
  user: { id: string; email: string; name: string };
  activeOrganizationId: string | null;
  activeSupplierId: string | null;
  permissions: string[];
  memberships: Array<{
    organization: { id: string; slug: string; legalName: string };
    supplier: { id: string; name: string } | null;
    roles: Array<{ key: string; name: string }>;
  }>;
}

export async function getMe(): Promise<Me | null> {
  const result = await serverFetch<Me>('/me');
  return result.ok ? result.data : null;
}
