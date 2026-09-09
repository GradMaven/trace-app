-- Row-Level Security for Phase 13c (ADR-003, layer 2 / ADR-014).
--
-- `subscription`, `usage_counter`, `usage_event` are tenant-owned → RLS FORCE.
-- `plan` is the global plan catalogue (like the emission-factor library) and is
-- repository-scoped, not RLS'd.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscription', 'usage_counter', 'usage_event']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_org()) WITH CHECK (organization_id = current_org())',
      t
    );
  END LOOP;
END $$;
