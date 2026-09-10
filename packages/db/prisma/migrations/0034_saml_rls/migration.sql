-- Row-Level Security for Phase 13f (ADR-003, layer 2 / ADR-017).
--
-- `saml_provider` and `saml_link` are tenant config / tenant data → RLS FORCE.
-- `saml_login_request` is deliberately NOT RLS'd: it is looked up by
-- `relay_state` at the ACS *before* any session or org context exists (like
-- `sso_login_request` / `magic_link_token`). It carries `organization_id`, is
-- single-use, and expires.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['saml_provider', 'saml_link']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
