-- Phase 15 — Regulatory-filing export.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "regulatory_filing" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "regulation_key" TEXT NOT NULL,
    "rule_store_version" TEXT NOT NULL,
    "reporting_period" TEXT NOT NULL,
    "format_version" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "readiness" TEXT NOT NULL,
    "required_datapoints" INTEGER NOT NULL,
    "reported_datapoints" INTEGER NOT NULL,
    "gap_count" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "html_storage_key" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "supersedes_id" UUID,
    "generated_by_user_id" UUID,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_filing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_filing_org_reg_period_version_key" ON "regulatory_filing"("organization_id", "regulation_key", "reporting_period", "version");
CREATE INDEX "regulatory_filing_organization_id_generated_at_idx" ON "regulatory_filing"("organization_id", "generated_at");

-- AddForeignKey
ALTER TABLE "regulatory_filing" ADD CONSTRAINT "regulatory_filing_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "regulatory_filing" ADD CONSTRAINT "regulatory_filing_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "regulatory_filing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
