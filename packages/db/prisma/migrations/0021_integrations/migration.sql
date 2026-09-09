-- Phase 12 — Enterprise integrations.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('active', 'paused', 'error');
CREATE TYPE "integration_run_status" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "integration" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "integration_status" NOT NULL DEFAULT 'active',
    "last_run_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_run" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "integration_id" UUID,
    "kind" TEXT NOT NULL,
    "status" "integration_run_status" NOT NULL DEFAULT 'running',
    "file_name" TEXT,
    "file_checksum" TEXT,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "rows_total" INTEGER NOT NULL DEFAULT 0,
    "rows_valid" INTEGER NOT NULL DEFAULT 0,
    "rows_invalid" INTEGER NOT NULL DEFAULT 0,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "preview" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_activity_ids" UUID[],
    "ran_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "integration_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_organization_id_kind_idx" ON "integration"("organization_id", "kind");
CREATE INDEX "integration_run_organization_id_started_at_idx" ON "integration_run"("organization_id", "started_at");

-- AddForeignKey
ALTER TABLE "integration" ADD CONSTRAINT "integration_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_run" ADD CONSTRAINT "integration_run_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_run" ADD CONSTRAINT "integration_run_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
