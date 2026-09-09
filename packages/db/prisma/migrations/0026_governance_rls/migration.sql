-- Row-Level Security for Phase 13b (ADR-003, layer 2 / ADR-013).
--
-- `export_job`, `retention_policy`, `retention_run` are tenant-owned → RLS FORCE.
-- `user_mfa` is deliberately NOT RLS'd: it is keyed on the user and spans every
-- organization they belong to, exactly like `session` — it is part of how the
-- request's identity is established, not tenant data.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['export_job', 'retention_policy', 'retention_run']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
