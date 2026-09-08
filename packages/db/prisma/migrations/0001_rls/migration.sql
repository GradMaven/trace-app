-- Row-Level Security (ADR-003, layer 2).
--
-- Applied to unambiguously tenant-owned tables whose `organization_id` is
-- NOT NULL. The application opens each tenant unit of work with
--   SELECT set_config('app.current_org', <org uuid>, true)
-- (see withOrgContext). NULLIF(..., '') makes an unset or platform-context
-- value resolve to NULL, so policies fail closed (no rows).
--
-- FORCE makes the policies apply even to the table owner, which is the role the
-- app connects as in development. Production uses a dedicated non-superuser role
-- without BYPASSRLS.
--
-- Note: `audit_log`, `role`, `organization`, `session`, `magic_link_token` are
-- protected by the repository layer in Phase 1; RLS for the mixed-scope tables
-- is tracked as a follow-up (docs/decisions/README.md backlog).

CREATE OR REPLACE FUNCTION current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org', true), '')::uuid
$$;

-- business_unit -------------------------------------------------------------
ALTER TABLE "business_unit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_unit" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "business_unit"
  USING ("organization_id" = current_org())
  WITH CHECK ("organization_id" = current_org());

-- membership --------------------------------------------------------------
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "membership"
  USING ("organization_id" = current_org())
  WITH CHECK ("organization_id" = current_org());

-- invitation -------------------------------------------------------------
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitation"
  USING ("organization_id" = current_org())
  WITH CHECK ("organization_id" = current_org());
