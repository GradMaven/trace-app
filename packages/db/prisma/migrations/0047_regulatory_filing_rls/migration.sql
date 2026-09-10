-- Row-Level Security for Phase 15 (ADR-003, layer 2 / ADR-024).
--
-- `regulatory_filing` is tenant-owned → RLS FORCE on `current_org()`, like
-- `audit_package` and every other tenant data table.

ALTER TABLE "regulatory_filing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regulatory_filing" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "regulatory_filing"
  USING (organization_id = current_org())
  WITH CHECK (organization_id = current_org());
