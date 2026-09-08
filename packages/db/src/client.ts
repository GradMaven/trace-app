import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * Prisma client + tenant-scoped access.
 *
 * ADR-003: tenant isolation is enforced in two independent layers. This module
 * is layer 1 — every tenant-scoped unit of work runs inside `withOrgContext`,
 * which opens a transaction and sets `app.current_org`. Layer 2 is the Postgres
 * RLS policy keyed on that setting (migration 0001_rls).
 *
 * Do not import `PrismaClient` elsewhere. Feature code receives either a
 * `TenantDb` (from `withOrgContext`) or, in the narrow platform module, the
 * unscoped client from `getPrisma()`.
 */

export type TenantDb = Prisma.TransactionClient;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let singleton: PrismaClient | undefined;

export interface GetPrismaOptions {
  datasourceUrl?: string;
  log?: Prisma.LogLevel[];
}

export function getPrisma(options: GetPrismaOptions = {}): PrismaClient {
  if (singleton) return singleton;
  singleton = new PrismaClient({
    datasourceUrl: options.datasourceUrl,
    log: options.log ?? (process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']),
  });
  return singleton;
}

/** For tests: build an isolated client bound to a specific database URL. */
export function createPrisma(datasourceUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl });
}

export async function disconnectPrisma(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}

export function assertUuid(value: string, label = 'id'): string {
  if (!UUID_RE.test(value)) {
    throw new Error(`Expected ${label} to be a UUID, received: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Run `fn` inside a transaction scoped to one organization. Sets
 * `app.current_org` for the transaction so RLS policies apply to every
 * statement `fn` issues through the provided `TenantDb`.
 */
export async function withOrgContext<T>(
  organizationId: string,
  fn: (db: TenantDb) => Promise<T>,
  client: PrismaClient = getPrisma(),
): Promise<T> {
  assertUuid(organizationId, 'organizationId');
  return client.$transaction(async (tx) => {
    // Parameterized — set_config is a normal function call, unlike `SET LOCAL`.
    await tx.$executeRaw`SELECT set_config('app.current_org', ${organizationId}, true)`;
    return fn(tx);
  });
}

/**
 * Run `fn` inside a transaction with NO tenant scope. Only the platform module
 * (cross-organization administration) may use this. RLS-protected tables will
 * return no rows because `app.current_org` is unset.
 */
export async function withPlatformContext<T>(
  fn: (db: TenantDb) => Promise<T>,
  client: PrismaClient = getPrisma(),
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org', '', true)`;
    return fn(tx);
  });
}

export type { Prisma, PrismaClient };
