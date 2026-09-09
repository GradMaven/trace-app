-- Phase 13b — Enterprise identity & governance: MFA, data export, retention.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "export_job_status" AS ENUM ('pending', 'running', 'ready', 'failed', 'expired');
CREATE TYPE "retention_mode" AS ENUM ('dry_run', 'apply');

-- AlterTable
ALTER TABLE "organization"
  ADD COLUMN "require_mfa" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "legal_hold" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_mfa" (
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "recovery_codes" TEXT[],
    "confirmed_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" "export_job_status" NOT NULL DEFAULT 'pending',
    "reporting_period" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'trace.export/v1',
    "storage_key" TEXT,
    "sha256" TEXT,
    "size_bytes" INTEGER,
    "section_counts" JSONB NOT NULL DEFAULT '{}',
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "manifest" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "age_days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_run" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "policy_id" UUID,
    "target" TEXT NOT NULL,
    "mode" "retention_mode" NOT NULL,
    "age_days" INTEGER NOT NULL,
    "cutoff" TIMESTAMPTZ(6) NOT NULL,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "ran_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "retention_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_job_organization_id_created_at_idx" ON "export_job"("organization_id", "created_at");
CREATE UNIQUE INDEX "retention_policy_organization_id_target_key" ON "retention_policy"("organization_id", "target");
CREATE INDEX "retention_run_organization_id_started_at_idx" ON "retention_run"("organization_id", "started_at");

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retention_policy" ADD CONSTRAINT "retention_policy_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retention_run" ADD CONSTRAINT "retention_run_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "retention_run" ADD CONSTRAINT "retention_run_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "retention_policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
