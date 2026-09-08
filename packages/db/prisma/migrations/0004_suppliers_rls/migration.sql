-- Row-Level Security for the Phase 2 supplier tables (ADR-003, layer 2).
-- Same pattern as 0001_rls: policy keyed on current_org(), FORCEd so it applies
-- to the table owner (the role the app connects as in dev).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'supplier',
    'supplier_contact',
    'supplier_location',
    'supplier_relationship',
    'supplier_request',
    'supplier_evidence_ref',
    'supplier_passport'
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
