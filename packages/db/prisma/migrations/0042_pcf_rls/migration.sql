-- Row-Level Security for Phase 14b (ADR-003, layer 2 / ADR-021).
--
-- `product`, `bom_line` and `pcf_record` are unambiguously tenant-owned →
-- RLS FORCE on `current_org()`, like every other tenant data table.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product', 'bom_line', 'pcf_record']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
