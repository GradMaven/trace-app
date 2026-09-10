-- Row-Level Security for Phase 13h (ADR-003, layer 2 / ADR-019).
--
-- `billing_config` holds the provider secret key + webhook signing secret + the
-- price→plan map → RLS FORCE. The webhook handler resolves the org from the URL
-- slug, then opens `withOrgContext` to read the config and verify the signature.
--
-- `billing_event` and `billing_checkout` are system-written logs that carry
-- `organization_id`; every read path filters on it (like `webhook_delivery`).
-- They are NOT RLS'd so the worker can sweep stale checkouts cross-tenant.

ALTER TABLE "billing_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_config" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "billing_config"
  USING (organization_id = current_org())
  WITH CHECK (organization_id = current_org());
