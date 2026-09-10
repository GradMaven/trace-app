-- Phase 14c — Network scenario engine.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "network_scenario" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "engine_version" TEXT NOT NULL,
    "base_graph_version" INTEGER NOT NULL,
    "reporting_period" TEXT,
    "baseline_tco2e" DECIMAL(20,6) NOT NULL,
    "projected_tco2e" DECIMAL(20,6) NOT NULL,
    "delta_tco2e" DECIMAL(20,6) NOT NULL,
    "delta_pct" DECIMAL(10,4) NOT NULL,
    "interventions" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_scenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "network_scenario_organization_id_created_at_idx" ON "network_scenario"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "network_scenario" ADD CONSTRAINT "network_scenario_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
