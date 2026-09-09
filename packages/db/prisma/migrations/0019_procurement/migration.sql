-- Phase 11 — Procurement intelligence.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "procurement_scenario" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reporting_period" TEXT,
    "engine_version" TEXT NOT NULL,
    "baseline_tco2e" DECIMAL(20,4) NOT NULL,
    "projected_tco2e" DECIMAL(20,4) NOT NULL,
    "delta_tco2e" DECIMAL(20,4) NOT NULL,
    "delta_pct" DECIMAL(8,2) NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_scenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "procurement_scenario_organization_id_created_at_idx" ON "procurement_scenario"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "procurement_scenario" ADD CONSTRAINT "procurement_scenario_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
