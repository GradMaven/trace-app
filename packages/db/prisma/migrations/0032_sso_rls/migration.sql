-- Row-Level Security for Phase 13e (ADR-003, layer 2 / ADR-016).
--
-- `identity_provider` and `sso_link` are tenant-owned → RLS FORCE.
-- `sso_login_request` is deliberately NOT RLS'd: it is looked up by `state` at
-- the OIDC callback *before* any session or org context exists (like
-- `magic_link_token`). It carries `organization_id`, is single-use, and expires.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['identity_provider', 'sso_link']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
