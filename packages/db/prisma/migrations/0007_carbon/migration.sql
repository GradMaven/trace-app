-- Phase 4 — Carbon Engine.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).
-- CI verifies drift with `prisma migrate diff --exit-code`.

-- CreateEnum
CREATE TYPE "ghg_scope" AS ENUM ('scope_1', 'scope_2_location', 'scope_2_market', 'scope_3');
CREATE TYPE "ghg_category" AS ENUM (
  'cat_1_purchased_goods_services', 'cat_2_capital_goods', 'cat_3_fuel_energy_activities',
  'cat_4_upstream_transportation', 'cat_5_waste_generated', 'cat_6_business_travel',
  'cat_7_employee_commuting', 'cat_8_upstream_leased_assets', 'cat_9_downstream_transportation',
  'cat_10_processing_sold_products', 'cat_11_use_sold_products', 'cat_12_end_of_life_sold_products',
  'cat_13_downstream_leased_assets', 'cat_14_franchises', 'cat_15_investments'
);
CREATE TYPE "methodology" AS ENUM (
  'supplier_specific', 'average_data', 'spend_based', 'distance_based', 'fuel_based',
  'energy_based', 'hybrid'
);
CREATE TYPE "co2e_unit" AS ENUM ('gCO2e', 'kgCO2e', 'tCO2e', 'ktCO2e');

-- AlterTable
ALTER TABLE "datapoint" ADD COLUMN "calculation_id" UUID;

-- CreateTable
CREATE TABLE "emission_factor" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "source" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" DECIMAL(30,12) NOT NULL,
    "numerator_unit" "co2e_unit" NOT NULL,
    "denominator_unit" TEXT NOT NULL,
    "activity_dimension" TEXT NOT NULL,
    "gwp_set" TEXT NOT NULL DEFAULT 'AR6',
    "scope" "ghg_scope" NOT NULL,
    "ghg_category" "ghg_category",
    "geography" TEXT,
    "methodology" "methodology",
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emission_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_data" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "scope" "ghg_scope" NOT NULL,
    "ghg_category" "ghg_category",
    "category" TEXT NOT NULL,
    "description" TEXT,
    "value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "reporting_period" TEXT NOT NULL,
    "provenance" "provenance" NOT NULL DEFAULT 'supplier_reported',
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "supplier_id" UUID,
    "source_ref" TEXT,
    "occurred_on" DATE,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "activity_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_evidence" (
    "organization_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "linked_by_user_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_evidence_pkey" PRIMARY KEY ("activity_id", "evidence_id")
);

-- CreateTable
CREATE TABLE "calculation" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "emission_factor_id" UUID NOT NULL,
    "methodology" "methodology" NOT NULL,
    "input_value" DECIMAL(20,6) NOT NULL,
    "input_unit" TEXT NOT NULL,
    "normalized_value" DECIMAL(30,12) NOT NULL,
    "normalized_unit" TEXT NOT NULL,
    "factor_value" DECIMAL(30,12) NOT NULL,
    "factor_numerator_unit" "co2e_unit" NOT NULL,
    "factor_denominator_unit" TEXT NOT NULL,
    "factor_source" TEXT NOT NULL,
    "factor_version" INTEGER NOT NULL,
    "gwp_set" TEXT NOT NULL,
    "scope" "ghg_scope" NOT NULL,
    "ghg_category" "ghg_category",
    "reporting_period" TEXT NOT NULL,
    "result_value_tco2e" DECIMAL(20,6) NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "factor_selection_reasons" JSONB NOT NULL DEFAULT '[]',
    "calculation_version" TEXT NOT NULL,
    "supersedes_id" UUID,
    "calculated_by_user_id" UUID NOT NULL,
    "calculated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),

    CONSTRAINT "calculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emission" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "scope" "ghg_scope" NOT NULL,
    "ghg_category" "ghg_category",
    "reporting_period" TEXT NOT NULL,
    "value_tco2e" DECIMAL(20,6) NOT NULL,
    "calculation_count" INTEGER NOT NULL,
    "method_summary" TEXT NOT NULL,
    "source_calculation_ids" UUID[],
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emission_factor_source_source_ref_idx" ON "emission_factor"("source", "source_ref");
CREATE INDEX "emission_factor_organization_id_scope_idx" ON "emission_factor"("organization_id", "scope");
CREATE INDEX "emission_factor_scope_ghg_category_idx" ON "emission_factor"("scope", "ghg_category");
CREATE INDEX "activity_data_organization_id_reporting_period_idx" ON "activity_data"("organization_id", "reporting_period");
CREATE INDEX "activity_data_organization_id_scope_idx" ON "activity_data"("organization_id", "scope");
CREATE INDEX "activity_data_organization_id_subject_type_subject_id_idx" ON "activity_data"("organization_id", "subject_type", "subject_id");
CREATE INDEX "activity_evidence_organization_id_idx" ON "activity_evidence"("organization_id");
CREATE INDEX "activity_evidence_evidence_id_idx" ON "activity_evidence"("evidence_id");
CREATE INDEX "calculation_organization_id_scope_reporting_period_idx" ON "calculation"("organization_id", "scope", "reporting_period");
CREATE INDEX "calculation_organization_id_activity_id_idx" ON "calculation"("organization_id", "activity_id");
CREATE UNIQUE INDEX "emission_organization_id_scope_ghg_category_reporting_period_key" ON "emission"("organization_id", "scope", "ghg_category", "reporting_period");
CREATE INDEX "emission_organization_id_reporting_period_idx" ON "emission"("organization_id", "reporting_period");

-- AddForeignKey
ALTER TABLE "datapoint" ADD CONSTRAINT "datapoint_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "calculation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emission_factor" ADD CONSTRAINT "emission_factor_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_data" ADD CONSTRAINT "activity_data_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_evidence" ADD CONSTRAINT "activity_evidence_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity_data"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_evidence" ADD CONSTRAINT "activity_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calculation" ADD CONSTRAINT "calculation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calculation" ADD CONSTRAINT "calculation_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity_data"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calculation" ADD CONSTRAINT "calculation_emission_factor_id_fkey" FOREIGN KEY ("emission_factor_id") REFERENCES "emission_factor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calculation" ADD CONSTRAINT "calculation_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "calculation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emission" ADD CONSTRAINT "emission_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
