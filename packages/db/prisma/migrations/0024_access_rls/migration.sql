-- Row-Level Security for Phase 13 (ADR-003, layer 2 / ADR-012).
--
-- `webhook_endpoint` is a tenant-configured resource — RLS FORCE, like every
-- other tenant table.
--
-- `api_key` is deliberately NOT RLS'd: it is an authentication credential looked
-- up globally by `hashed_secret` to *establish* the org context (exactly like
-- `session` / `magic_link_token`), so it cannot itself be gated by that context.
-- `webhook_delivery` is deliberately NOT RLS'd: it is a system-written
-- operational log (like `audit_log`) that the platform-level dispatcher sweeps
-- across every tenant. Both carry `organization_id` and every read path in
-- @trace/db filters on it explicitly.

ALTER TABLE "webhook_endpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "webhook_endpoint"
  USING ("organization_id" = current_org())
  WITH CHECK ("organization_id" = current_org());
