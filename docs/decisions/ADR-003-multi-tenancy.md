# ADR-003: Multi-tenancy strategy

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Lead product architect / staff engineering (acting)
- **Phase:** 0

## Context

TRACE is enterprise SaaS. Every organization's data — suppliers, evidence, calculations,
audit history — must be isolated. The brief (§17) is explicit: tenant isolation must be
enforced at the backend/data layer, never by frontend filtering alone. Some large customers
will eventually demand physical isolation.

## Options considered

### Option A — Database per tenant
Separate Postgres database (or cluster) per organization.

- Pros: strongest isolation; simple mental model; per-tenant backup/restore; easy residency
  per customer.
- Cons: heavy operational cost at low tenant counts; migrations fan out across N databases;
  cross-tenant platform queries (billing, ops) are awkward; slow onboarding. Premature for
  pre-PMF.

### Option B — Schema per tenant
One database, a Postgres schema per organization.

- Pros: decent isolation; single cluster.
- Cons: hundreds/thousands of schemas strain tooling; migrations still fan out; Prisma
  multi-schema ergonomics are poor; connection/search_path juggling.

### Option C — Shared database, shared schema, row-level discrimination + RLS
One schema. Every tenant-owned row carries `organization_id NOT NULL`. Isolation enforced by
(1) a repository layer that scopes every query and (2) Postgres Row-Level Security keyed on
a per-transaction session variable.

- Pros: simplest ops; one migration; fast onboarding; platform queries are trivial; RLS is
  a hard backstop independent of application code.
- Cons: a bug that bypasses both layers is cross-tenant; "noisy neighbour" at the DB;
  physical isolation not available without more work.

## Decision

**Option C for the platform baseline**, with a designed path to Option A for customers that
contractually require physical isolation.

### Enforcement (defence in depth)

1. **Request/job context** — `AsyncLocalStorage` carries
   `{ organizationId, userId, permissions, requestId }`. The tenant is derived from the
   authenticated session or API key, never from a request body/param. `X-Organization-Id`
   only *selects* among a user's memberships and is validated server-side.
2. **Repository layer** (`packages/db`) — a base repository injects `organization_id` into
   every `where`, `create`, `update`, `delete`. Direct `prisma.<model>` access outside
   `packages/db` fails lint (`no-restricted-imports`).
3. **Postgres RLS** — every tenant table:
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON <t>
     USING (organization_id = current_setting('app.current_org')::uuid)
     WITH CHECK (organization_id = current_setting('app.current_org')::uuid);
   ```
   The DB layer runs each unit of work as
   `BEGIN; SET LOCAL app.current_org = $orgId; … COMMIT;`. The application DB role is not a
   superuser and does not have `BYPASSRLS`.
4. **Platform tables** (`organization`, global `user`, `permission` catalog) are not
   tenant-scoped and are reached only through a separate, narrowly-permissioned module.
5. **CI security tests** — automated attempts at cross-tenant read/write/file access must
   fail closed (Principle 41).

### Path to physical isolation

A "dedicated" tenant gets its own database. A connection resolver maps `organizationId →
datasource`. Repositories and domain code are unchanged because they already never assume a
single connection. Migrations run per datasource.

## Consequences

- **Positive:** minimal ops; single migration path; fast onboarding; RLS is a
  code-independent backstop; clean upgrade path to dedicated DBs.
- **Trade-offs accepted:** shared cluster resource contention; correctness depends on the
  repository layer + RLS both being right (hence CI tests and `FORCE ROW LEVEL SECURITY`);
  large per-tenant data volumes may later need partitioning by `organization_id`.
- **Commits us to:** `organization_id` on every tenant table from the first migration; the
  repository discipline; a non-superuser app DB role; per-transaction session-variable
  plumbing in `packages/db`.

## Revisit when

- A customer contract requires physical isolation or a specific residency → activate the
  dedicated-DB path for that tenant.
- A single tenant's data volume degrades shared-table performance → introduce table
  partitioning by `organization_id` or promote that tenant to a dedicated DB.
