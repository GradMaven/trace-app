-- Row-Level Security for Phase 14c (ADR-003, layer 2 / ADR-022).
--
-- `network_scenario` is unambiguously tenant-owned → RLS FORCE on `current_org()`,
-- like `procurement_scenario` and every other tenant data table.

ALTER TABLE "network_scenario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "network_scenario" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "network_scenario"
  USING (organization_id = current_org())
  WITH CHECK (organization_id = current_org());
