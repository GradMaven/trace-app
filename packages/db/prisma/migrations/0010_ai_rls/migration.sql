-- Row-Level Security for the Phase 5 AI tables (ADR-003, layer 2).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_job',
    'document_extraction',
    'candidate_datapoint'
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
