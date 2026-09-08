-- Row-Level Security for the Phase 4 carbon tables (ADR-003, layer 2).
-- `emission_factor` is intentionally excluded: it holds both the shared library
-- (organization_id IS NULL) and tenant-custom factors, and is scoped by the
-- repository layer (like `role`).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_data',
    'activity_evidence',
    'calculation',
    'emission'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
