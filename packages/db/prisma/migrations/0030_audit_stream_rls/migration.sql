-- Row-Level Security for Phase 13d (ADR-003, layer 2 / ADR-015).
--
-- `audit_stream` is a tenant-configured resource → RLS FORCE.
-- `audit_stream_delivery` is a system-written operational log the worker sweeps
-- per organization; it is NOT RLS'd (like `webhook_delivery`) — it carries
-- `organization_id` and every read path filters on it.
-- `component_heartbeat` has no organization scope.

ALTER TABLE "audit_stream" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_stream" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_stream"
  USING ("organization_id" = current_org())
  WITH CHECK ("organization_id" = current_org());
