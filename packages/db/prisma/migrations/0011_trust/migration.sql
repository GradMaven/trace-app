-- Phase 6 — Trust Engine.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "trust_band" AS ENUM ('high', 'medium', 'low');
CREATE TYPE "data_quality_issue_kind" AS ENUM (
  'missing_value', 'missing_unit', 'missing_evidence', 'unverified_evidence',
  'expired_evidence', 'stale_data', 'unit_inconsistency', 'impossible_value',
  'duplicate', 'conflicting_supplier_report', 'outdated_factor', 'low_methodology_tier'
);
CREATE TYPE "issue_severity" AS ENUM ('critical', 'warning', 'info');
CREATE TYPE "issue_status" AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');
CREATE TYPE "anomaly_method" AS ENUM ('mad_outlier', 'relative_change');
CREATE TYPE "anomaly_status" AS ENUM ('open', 'explained', 'dismissed');

-- CreateTable
CREATE TABLE "trust_score" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "datapoint_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "reporting_period" TEXT,
    "value" INTEGER NOT NULL,
    "band" "trust_band" NOT NULL,
    "breakdown" JSONB NOT NULL DEFAULT '[]',
    "model_version" TEXT NOT NULL,
    "inputs_digest" TEXT NOT NULL,
    "supersedes_id" UUID,
    "computed_by_user_id" UUID,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_issue" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "data_quality_issue_kind" NOT NULL,
    "severity" "issue_severity" NOT NULL,
    "status" "issue_status" NOT NULL DEFAULT 'open',
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "datapoint_id" UUID,
    "metric_key" TEXT,
    "reporting_period" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "facts" JSONB NOT NULL DEFAULT '{}',
    "rules_version" TEXT NOT NULL,
    "first_detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    "resolution_note" TEXT,

    CONSTRAINT "data_quality_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomaly" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "method" "anomaly_method" NOT NULL,
    "status" "anomaly_status" NOT NULL DEFAULT 'open',
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "datapoint_id" UUID,
    "metric_key" TEXT NOT NULL,
    "point_key" TEXT NOT NULL,
    "reporting_period" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "observed_value" DECIMAL(30,6) NOT NULL,
    "expected_value" DECIMAL(30,6) NOT NULL,
    "score" DECIMAL(12,4) NOT NULL,
    "direction" TEXT NOT NULL,
    "explanations" JSONB NOT NULL DEFAULT '[]',
    "detector_version" TEXT NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,

    CONSTRAINT "anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_scan" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reporting_period" TEXT,
    "datapoints_scored" INTEGER NOT NULL DEFAULT 0,
    "avg_trust_score" DECIMAL(6,2),
    "issues_opened" INTEGER NOT NULL DEFAULT 0,
    "issues_resolved" INTEGER NOT NULL DEFAULT 0,
    "issues_open" INTEGER NOT NULL DEFAULT 0,
    "anomalies_found" INTEGER NOT NULL DEFAULT 0,
    "model_version" TEXT NOT NULL,
    "rules_version" TEXT NOT NULL,
    "detector_version" TEXT NOT NULL,
    "ran_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quality_scan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trust_score_organization_id_datapoint_id_computed_at_idx" ON "trust_score"("organization_id", "datapoint_id", "computed_at");
CREATE INDEX "trust_score_organization_id_band_idx" ON "trust_score"("organization_id", "band");
CREATE UNIQUE INDEX "data_quality_issue_organization_id_dedupe_key_key" ON "data_quality_issue"("organization_id", "dedupe_key");
CREATE INDEX "data_quality_issue_organization_id_status_severity_idx" ON "data_quality_issue"("organization_id", "status", "severity");
CREATE INDEX "data_quality_issue_organization_id_kind_idx" ON "data_quality_issue"("organization_id", "kind");
CREATE UNIQUE INDEX "anomaly_organization_id_dedupe_key_key" ON "anomaly"("organization_id", "dedupe_key");
CREATE INDEX "anomaly_organization_id_status_idx" ON "anomaly"("organization_id", "status");
CREATE INDEX "anomaly_organization_id_metric_key_idx" ON "anomaly"("organization_id", "metric_key");
CREATE INDEX "quality_scan_organization_id_started_at_idx" ON "quality_scan"("organization_id", "started_at");

-- AddForeignKey
ALTER TABLE "trust_score" ADD CONSTRAINT "trust_score_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_score" ADD CONSTRAINT "trust_score_datapoint_id_fkey" FOREIGN KEY ("datapoint_id") REFERENCES "datapoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_score" ADD CONSTRAINT "trust_score_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "trust_score"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "data_quality_issue" ADD CONSTRAINT "data_quality_issue_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_quality_issue" ADD CONSTRAINT "data_quality_issue_datapoint_id_fkey" FOREIGN KEY ("datapoint_id") REFERENCES "datapoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "anomaly" ADD CONSTRAINT "anomaly_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "anomaly" ADD CONSTRAINT "anomaly_datapoint_id_fkey" FOREIGN KEY ("datapoint_id") REFERENCES "datapoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quality_scan" ADD CONSTRAINT "quality_scan_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
