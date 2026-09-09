-- Row-Level Security for the Phase 12 integration tables (ADR-003, layer 2).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration', 'integration_run']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
