-- Row-Level Security for Phase 13g (ADR-003, layer 2 / ADR-018).
--
-- `scim_config` (holds the bearer-token hash + role mapping), `scim_user` and
-- `scim_group` are tenant config / tenant data → RLS FORCE. The pre-auth SCIM
-- request resolves the org from the URL slug, verifies the bearer token, then
-- opens `withOrgContext`.
--
-- `scim_group_member` is a pure join with no `organization_id` column (like
-- `membership_role`) — it is NOT RLS'd; every read path reaches it only through
-- the RLS'd `scim_group` / `scim_user` parents.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['scim_config', 'scim_user', 'scim_group']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
