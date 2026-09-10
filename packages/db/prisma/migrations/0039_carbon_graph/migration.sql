-- Phase 14 — Carbon Twin: supply-chain graph.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "supply_chain_edge" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_supplier_id" UUID NOT NULL,
    "to_supplier_id" UUID,
    "to_label" TEXT NOT NULL,
    "relationship" TEXT,
    "tier" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "supply_chain_edge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carbon_graph_snapshot" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "builder_version" TEXT NOT NULL,
    "reporting_period" TEXT,
    "data" JSONB NOT NULL,
    "node_count" INTEGER NOT NULL,
    "edge_count" INTEGER NOT NULL,
    "total_tco2e" DECIMAL(20,6) NOT NULL,
    "attributed_pct" INTEGER NOT NULL,
    "hotspot_count" INTEGER NOT NULL,
    "computed_by_user_id" UUID,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carbon_graph_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supply_chain_edge_organization_id_from_supplier_id_to_label_key" ON "supply_chain_edge"("organization_id", "from_supplier_id", "to_label");
CREATE INDEX "supply_chain_edge_organization_id_from_supplier_id_idx" ON "supply_chain_edge"("organization_id", "from_supplier_id");
CREATE UNIQUE INDEX "carbon_graph_snapshot_organization_id_version_key" ON "carbon_graph_snapshot"("organization_id", "version");
CREATE INDEX "carbon_graph_snapshot_organization_id_computed_at_idx" ON "carbon_graph_snapshot"("organization_id", "computed_at");

-- AddForeignKey
ALTER TABLE "supply_chain_edge" ADD CONSTRAINT "supply_chain_edge_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supply_chain_edge" ADD CONSTRAINT "supply_chain_edge_from_supplier_id_fkey" FOREIGN KEY ("from_supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supply_chain_edge" ADD CONSTRAINT "supply_chain_edge_to_supplier_id_fkey" FOREIGN KEY ("to_supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "carbon_graph_snapshot" ADD CONSTRAINT "carbon_graph_snapshot_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
