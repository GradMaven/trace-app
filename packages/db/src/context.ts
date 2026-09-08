import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient request/job context (docs/architecture.md — "Request context").
 *
 * Carried by AsyncLocalStorage for the lifetime of a request or background job so
 * that the DB layer, audit writer, and services read the tenant and actor from
 * one place instead of threading them through every signature.
 */
export interface RequestContext {
  requestId: string;
  organizationId: string | null;
  userId: string | null;
  /** Resolved permission keys for the actor in the active organization. */
  permissions: readonly string[];
  locale: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('No RequestContext is active. Wrap the operation in runWithContext().');
  }
  return ctx;
}

export function requireOrganizationId(): string {
  const { organizationId } = requireContext();
  if (!organizationId) {
    throw new Error('The active RequestContext has no organizationId.');
  }
  return organizationId;
}
