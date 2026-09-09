-- Phase 7 — Compliance.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).
--
-- regulation / requirement / disclosure / required_datapoint / evidence_requirement
-- are GLOBAL rows (no organization_id) — the versioned rule store — and are NOT
-- RLS'd, like emission_factor library rows. The tenant-owned tables
-- (compliance_control, compliance_mapping, disclosure_status, compliance_run)
-- get RLS in 0014_compliance_rls.

-- CreateEnum
CREATE TYPE "compliance_status" AS ENUM (
  'not_started', 'data_available', 'evidence_available', 'mapping_complete', 'review_required'
);
CREATE TYPE "control_status" AS ENUM (
  'not_implemented', 'implemented', 'needs_testing', 'passed', 'failed'
);

-- CreateTable
CREATE TABLE "regulation" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rule_store_version" TEXT NOT NULL,
    "notice" TEXT NOT NULL DEFAULT '',
    "loaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "requirement" (
    "id" UUID NOT NULL,
    "regulation_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rule_store_version" TEXT NOT NULL,

    CONSTRAINT "requirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "disclosure" (
    "id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "guidance" TEXT NOT NULL DEFAULT '',
    "rule_store_version" TEXT NOT NULL,

    CONSTRAINT "disclosure_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "required_datapoint" (
    "id" UUID NOT NULL,
    "disclosure_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "unit" TEXT,
    "cardinality" TEXT NOT NULL DEFAULT 'single',
    "subject_scope" TEXT NOT NULL DEFAULT 'organization',
    "aggregation" TEXT NOT NULL DEFAULT 'single',
    "min_trust_score" INTEGER,
    "label" TEXT NOT NULL DEFAULT '',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "rule_store_version" TEXT NOT NULL,

    CONSTRAINT "required_datapoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evidence_requirement" (
    "id" UUID NOT NULL,
    "disclosure_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptable_types" TEXT[],
    "rule_store_version" TEXT NOT NULL,

    CONSTRAINT "evidence_requirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_control" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requirement_id" UUID,
    "rule_store_version" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "owner" TEXT,
    "status" "control_status" NOT NULL DEFAULT 'not_implemented',
    "last_tested_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_control_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_mapping" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "required_datapoint_id" UUID NOT NULL,
    "disclosure_id" UUID NOT NULL,
    "rule_store_version" TEXT NOT NULL,
    "reporting_period" TEXT,
    "status" "compliance_status" NOT NULL DEFAULT 'not_started',
    "gap_reasons" TEXT[],
    "datapoint_ids" UUID[],
    "calculation_ids" UUID[],
    "evidence_ids" UUID[],
    "resolved_value" DECIMAL(30,6),
    "resolved_value_text" TEXT,
    "trust_score" INTEGER,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_mapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "disclosure_status" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "disclosure_id" UUID NOT NULL,
    "rule_store_version" TEXT NOT NULL,
    "reporting_period" TEXT,
    "status" "compliance_status" NOT NULL DEFAULT 'not_started',
    "required_total" INTEGER NOT NULL DEFAULT 0,
    "satisfied" INTEGER NOT NULL DEFAULT 0,
    "readiness_pct" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disclosure_status_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_run" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rule_store_version" TEXT NOT NULL,
    "reporting_period" TEXT,
    "disclosures_evaluated" INTEGER NOT NULL DEFAULT 0,
    "required_datapoints" INTEGER NOT NULL DEFAULT 0,
    "mappings_written" INTEGER NOT NULL DEFAULT 0,
    "readiness_pct" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "ran_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "compliance_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regulation_key_rule_store_version_key" ON "regulation"("key", "rule_store_version");
CREATE UNIQUE INDEX "requirement_regulation_id_code_key" ON "requirement"("regulation_id", "code");
CREATE UNIQUE INDEX "disclosure_requirement_id_code_rule_store_version_key" ON "disclosure"("requirement_id", "code", "rule_store_version");
CREATE UNIQUE INDEX "required_datapoint_key_rule_store_version_key" ON "required_datapoint"("key", "rule_store_version");
CREATE INDEX "required_datapoint_metric_key_idx" ON "required_datapoint"("metric_key");
CREATE UNIQUE INDEX "evidence_requirement_disclosure_id_key_rule_store_version_key" ON "evidence_requirement"("disclosure_id", "key", "rule_store_version");
CREATE UNIQUE INDEX "compliance_control_organization_id_key_key" ON "compliance_control"("organization_id", "key");
CREATE INDEX "compliance_control_organization_id_status_idx" ON "compliance_control"("organization_id", "status");
CREATE UNIQUE INDEX "compliance_mapping_organization_id_required_datapoint_id_rule_store_version_key" ON "compliance_mapping"("organization_id", "required_datapoint_id", "rule_store_version");
CREATE INDEX "compliance_mapping_organization_id_status_idx" ON "compliance_mapping"("organization_id", "status");
CREATE INDEX "compliance_mapping_organization_id_disclosure_id_idx" ON "compliance_mapping"("organization_id", "disclosure_id");
CREATE UNIQUE INDEX "disclosure_status_organization_id_disclosure_id_rule_store_version_key" ON "disclosure_status"("organization_id", "disclosure_id", "rule_store_version");
CREATE INDEX "disclosure_status_organization_id_status_idx" ON "disclosure_status"("organization_id", "status");
CREATE INDEX "compliance_run_organization_id_started_at_idx" ON "compliance_run"("organization_id", "started_at");

-- AddForeignKey
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_regulation_id_fkey" FOREIGN KEY ("regulation_id") REFERENCES "regulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disclosure" ADD CONSTRAINT "disclosure_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "required_datapoint" ADD CONSTRAINT "required_datapoint_disclosure_id_fkey" FOREIGN KEY ("disclosure_id") REFERENCES "disclosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_requirement" ADD CONSTRAINT "evidence_requirement_disclosure_id_fkey" FOREIGN KEY ("disclosure_id") REFERENCES "disclosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_control" ADD CONSTRAINT "compliance_control_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_control" ADD CONSTRAINT "compliance_control_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compliance_mapping" ADD CONSTRAINT "compliance_mapping_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_mapping" ADD CONSTRAINT "compliance_mapping_required_datapoint_id_fkey" FOREIGN KEY ("required_datapoint_id") REFERENCES "required_datapoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_mapping" ADD CONSTRAINT "compliance_mapping_disclosure_id_fkey" FOREIGN KEY ("disclosure_id") REFERENCES "disclosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disclosure_status" ADD CONSTRAINT "disclosure_status_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disclosure_status" ADD CONSTRAINT "disclosure_status_disclosure_id_fkey" FOREIGN KEY ("disclosure_id") REFERENCES "disclosure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_run" ADD CONSTRAINT "compliance_run_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
