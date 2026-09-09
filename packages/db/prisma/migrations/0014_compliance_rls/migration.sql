-- Row-Level Security for the Phase 7 tenant-owned compliance tables
-- (ADR-003, layer 2). The rule-store tables (regulation, requirement,
-- disclosure, required_datapoint, evidence_requirement) are global and are
-- deliberately NOT RLS'd — like emission_factor library rows.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'compliance_control',
    'compliance_mapping',
    'disclosure_status',
    'compliance_run'
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
