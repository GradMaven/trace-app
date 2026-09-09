-- Row-Level Security for the Phase 10 Ask TRACE table (ADR-003, layer 2).

ALTER TABLE "ask_query" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ask_query" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ask_query"
  USING (organization_id = current_org())
  WITH CHECK (organization_id = current_org());
