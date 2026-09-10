-- Row-Level Security for Phase 14 (ADR-003, layer 2 / ADR-020).
--
-- `supply_chain_edge` and `carbon_graph_snapshot` are unambiguously tenant-owned
-- → RLS FORCE on `current_org()`, like every other tenant data table.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supply_chain_edge', 'carbon_graph_snapshot']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
