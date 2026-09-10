import { createPrisma } from '../../src/client';

/**
 * Integration-test global setup.
 *
 * RLS (ADR-003, layer 2) is enforced with `FORCE ROW LEVEL SECURITY`, which
 * covers the table *owner* — but PostgreSQL still lets a **superuser** (and any
 * role with `BYPASSRLS`) bypass every policy. CI's throwaway database connects
 * as the `POSTGRES_USER` bootstrap role, which is a superuser that cannot have
 * its superuser attribute removed, so without this step every `withOrgContext`
 * query would see across tenants and the isolation assertions would all fail.
 *
 * Migrations have already run (as the superuser) by the time this executes. We
 * create a dedicated **non-superuser, non-BYPASSRLS** role — the same shape
 * production uses for the app connection — grant it plain DML on the schema, and
 * repoint `DATABASE_URL_TEST` at it so the test workers (spawned after this)
 * connect as that role and RLS actually bites. Idempotent.
 */

const APP_ROLE = 'trace_test_app';
const APP_PASSWORD = 'trace_test_app';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) return;

  const admin = createPrisma(url);
  try {
    await admin.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);
    await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await admin.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await admin.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    );
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_ROLE}`,
    );
  } finally {
    await admin.$disconnect();
  }

  const rewritten = new URL(url);
  rewritten.username = APP_ROLE;
  rewritten.password = APP_PASSWORD;
  process.env.DATABASE_URL_TEST = rewritten.toString();
}
