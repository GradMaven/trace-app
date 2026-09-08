-- Phase 5 — AI Document Intelligence.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "ai_job_status" AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE "extraction_status" AS ENUM ('pending', 'parsing', 'parsed', 'classifying', 'extracting', 'ready_for_review', 'failed');
CREATE TYPE "candidate_status" AS ENUM ('pending', 'promoted', 'rejected');

-- CreateTable
CREATE TABLE "ai_job" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "input_type" TEXT NOT NULL,
    "input_ref" TEXT NOT NULL,
    "document_id" UUID,
    "status" "ai_job_status" NOT NULL DEFAULT 'running',
    "output" JSONB,
    "confidence" DECIMAL(5,2),
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_eur" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "reviewer_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_extraction" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "status" "extraction_status" NOT NULL DEFAULT 'pending',
    "parser" TEXT,
    "parsed_text" TEXT,
    "page_count" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "classification" JSONB,
    "ai_job_ids" UUID[],
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_datapoint" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "extraction_id" UUID,
    "ai_job_id" UUID,
    "metric_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value_numeric" DECIMAL(20,6),
    "value_text" TEXT,
    "unit" TEXT,
    "reporting_period" TEXT,
    "provenance_guess" "provenance" NOT NULL DEFAULT 'supplier_reported',
    "confidence" DECIMAL(5,2) NOT NULL,
    "source_spans" JSONB NOT NULL DEFAULT '[]',
    "rationale" TEXT,
    "status" "candidate_status" NOT NULL DEFAULT 'pending',
    "promoted_datapoint_id" UUID,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_datapoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_extraction_document_id_key" ON "document_extraction"("document_id");
CREATE INDEX "ai_job_organization_id_created_at_idx" ON "ai_job"("organization_id", "created_at");
CREATE INDEX "ai_job_organization_id_capability_idx" ON "ai_job"("organization_id", "capability");
CREATE INDEX "document_extraction_organization_id_status_idx" ON "document_extraction"("organization_id", "status");
CREATE INDEX "candidate_datapoint_organization_id_status_idx" ON "candidate_datapoint"("organization_id", "status");
CREATE INDEX "candidate_datapoint_organization_id_document_id_idx" ON "candidate_datapoint"("organization_id", "document_id");

-- AddForeignKey
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_job" ADD CONSTRAINT "ai_job_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_extraction" ADD CONSTRAINT "document_extraction_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_datapoint" ADD CONSTRAINT "candidate_datapoint_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_datapoint" ADD CONSTRAINT "candidate_datapoint_promoted_datapoint_id_fkey" FOREIGN KEY ("promoted_datapoint_id") REFERENCES "datapoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
