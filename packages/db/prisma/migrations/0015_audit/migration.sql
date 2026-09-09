-- Phase 8 — Audit workspace.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "audit_status" AS ENUM ('planning', 'fieldwork', 'review', 'complete');
CREATE TYPE "finding_severity" AS ENUM ('critical', 'warning', 'info');
CREATE TYPE "finding_source" AS ENUM ('manual', 'simulation');
CREATE TYPE "finding_status" AS ENUM ('open', 'acknowledged', 'remediating', 'resolved', 'accepted_risk', 'dismissed');
CREATE TYPE "audit_package_status" AS ENUM ('generating', 'ready', 'failed');

-- CreateTable
CREATE TABLE "audit" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "reporting_period" TEXT,
    "period_start" DATE,
    "period_end" DATE,
    "status" "audit_status" NOT NULL DEFAULT 'planning',
    "lead_auditor_user_id" UUID,
    "external_auditor" TEXT,
    "rule_store_version" TEXT,
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_simulation_run" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "audit_id" UUID,
    "reporting_period" TEXT,
    "rule_store_version" TEXT,
    "readiness_value" INTEGER NOT NULL,
    "readiness_band" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL DEFAULT '[]',
    "issue_counts" JSONB NOT NULL DEFAULT '{}',
    "findings_opened" INTEGER NOT NULL DEFAULT 0,
    "findings_resolved" INTEGER NOT NULL DEFAULT 0,
    "findings_open" INTEGER NOT NULL DEFAULT 0,
    "model_version" TEXT NOT NULL,
    "ran_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_simulation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_finding" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "audit_id" UUID,
    "simulation_run_id" UUID,
    "source" "finding_source" NOT NULL DEFAULT 'manual',
    "severity" "finding_severity" NOT NULL,
    "kind" TEXT,
    "status" "finding_status" NOT NULL DEFAULT 'open',
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "recommendation" TEXT,
    "raised_by_user_id" UUID,
    "assigned_to_user_id" UUID,
    "due_on" DATE,
    "first_detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_package" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "audit_id" UUID,
    "reporting_period" TEXT,
    "rule_store_version" TEXT,
    "status" "audit_package_status" NOT NULL DEFAULT 'generating',
    "format" TEXT NOT NULL DEFAULT 'json',
    "storage_key" TEXT,
    "storage_driver" TEXT,
    "size_bytes" INTEGER,
    "checksum_sha256" TEXT,
    "content_digest" TEXT NOT NULL DEFAULT '',
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "readiness_value" INTEGER,
    "generated_by_user_id" UUID,
    "generated_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_package_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_organization_id_status_idx" ON "audit"("organization_id", "status");
CREATE INDEX "audit_simulation_run_organization_id_started_at_idx" ON "audit_simulation_run"("organization_id", "started_at");
CREATE UNIQUE INDEX "audit_finding_organization_id_dedupe_key_key" ON "audit_finding"("organization_id", "dedupe_key");
CREATE INDEX "audit_finding_organization_id_status_severity_idx" ON "audit_finding"("organization_id", "status", "severity");
CREATE INDEX "audit_finding_organization_id_audit_id_idx" ON "audit_finding"("organization_id", "audit_id");
CREATE INDEX "audit_package_organization_id_created_at_idx" ON "audit_package"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit" ADD CONSTRAINT "audit_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_simulation_run" ADD CONSTRAINT "audit_simulation_run_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_simulation_run" ADD CONSTRAINT "audit_simulation_run_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_finding" ADD CONSTRAINT "audit_finding_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_finding" ADD CONSTRAINT "audit_finding_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_finding" ADD CONSTRAINT "audit_finding_simulation_run_id_fkey" FOREIGN KEY ("simulation_run_id") REFERENCES "audit_simulation_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_package" ADD CONSTRAINT "audit_package_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_package" ADD CONSTRAINT "audit_package_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
