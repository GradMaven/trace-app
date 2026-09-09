-- Row-Level Security for the Phase 11 procurement table (ADR-003, layer 2).

ALTER TABLE "procurement_scenario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procurement_scenario" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement_scenario"
  USING (organization_id = current_org())
  WITH CHECK (organization_id = current_org());
