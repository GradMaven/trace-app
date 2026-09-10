-- Phase 14b — Product carbon footprints.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "pcf_boundary" AS ENUM ('cradle_to_gate');
CREATE TYPE "pcf_line_kind" AS ENUM ('material', 'energy', 'transport', 'component', 'process', 'packaging');
CREATE TYPE "pcf_line_source" AS ENUM ('factor', 'supplier', 'sub_product', 'manual');
CREATE TYPE "pcf_data_tier" AS ENUM ('primary', 'secondary', 'estimated');
CREATE TYPE "allocation_method" AS ENUM ('none', 'mass', 'economic', 'physical');

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "functional_unit" TEXT NOT NULL,
    "reference_amount" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "reference_unit" TEXT NOT NULL,
    "boundary" "pcf_boundary" NOT NULL DEFAULT 'cradle_to_gate',
    "allocation_method" "allocation_method" NOT NULL DEFAULT 'none',
    "allocation_factor" DECIMAL(7,6) NOT NULL DEFAULT 1,
    "allocation_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_line" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "pcf_line_kind" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "source" "pcf_line_source" NOT NULL,
    "emission_factor_id" UUID,
    "supplier_id" UUID,
    "sub_product_id" UUID,
    "manual_kg_co2e" DECIMAL(20,6),
    "data_tier" "pcf_data_tier" NOT NULL DEFAULT 'secondary',
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bom_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pcf_record" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "method_version" TEXT NOT NULL,
    "boundary" "pcf_boundary" NOT NULL,
    "functional_unit" TEXT NOT NULL,
    "reporting_period" TEXT,
    "total_kg_co2e" DECIMAL(24,6) NOT NULL,
    "subtotal_kg_co2e" DECIMAL(24,6) NOT NULL,
    "allocation_method" "allocation_method" NOT NULL,
    "allocation_factor" DECIMAL(7,6) NOT NULL,
    "primary_data_share_pct" INTEGER NOT NULL,
    "data_quality_rating" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "inputs_digest" TEXT NOT NULL,
    "supersedes_id" UUID,
    "computed_by_user_id" UUID,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pcf_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_organization_id_name_idx" ON "product"("organization_id", "name");
CREATE INDEX "product_organization_id_status_idx" ON "product"("organization_id", "status");
CREATE INDEX "bom_line_organization_id_product_id_idx" ON "bom_line"("organization_id", "product_id");
CREATE UNIQUE INDEX "pcf_record_product_id_version_key" ON "pcf_record"("product_id", "version");
CREATE INDEX "pcf_record_organization_id_computed_at_idx" ON "pcf_record"("organization_id", "computed_at");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_emission_factor_id_fkey" FOREIGN KEY ("emission_factor_id") REFERENCES "emission_factor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bom_line" ADD CONSTRAINT "bom_line_sub_product_id_fkey" FOREIGN KEY ("sub_product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pcf_record" ADD CONSTRAINT "pcf_record_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pcf_record" ADD CONSTRAINT "pcf_record_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pcf_record" ADD CONSTRAINT "pcf_record_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "pcf_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;
