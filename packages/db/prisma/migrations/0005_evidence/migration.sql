-- Phase 3 — Evidence Infrastructure.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).
-- CI verifies drift with `prisma migrate diff --exit-code`.

-- CreateEnum
CREATE TYPE "provenance" AS ENUM ('measured', 'supplier_reported', 'calculated', 'estimated', 'modeled', 'inferred');
CREATE TYPE "data_label" AS ENUM ('ai_extracted', 'human_reviewed', 'verified');
CREATE TYPE "evidence_status" AS ENUM ('uploaded', 'processing', 'extracted', 'reviewed', 'verified', 'rejected', 'expired', 'superseded');
CREATE TYPE "document_processing_status" AS ENUM ('received', 'scanned', 'failed');
CREATE TYPE "scan_status" AS ENUM ('pending', 'clean', 'infected', 'skipped');

-- AlterTable
ALTER TABLE "supplier_evidence_ref" ADD COLUMN "document_id" UUID;
ALTER TABLE "supplier_evidence_ref" ADD COLUMN "promoted_evidence_id" UUID;

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "processing_status" "document_processing_status" NOT NULL DEFAULT 'received',
    "scan_status" "scan_status" NOT NULL DEFAULT 'pending',
    "retention_until" DATE,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "evidence_type" NOT NULL,
    "title" TEXT NOT NULL,
    "document_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_url" TEXT,
    "reporting_period" TEXT,
    "issuer" TEXT,
    "confidence_score" DECIMAL(5,2),
    "hash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "evidence_status" NOT NULL DEFAULT 'uploaded',
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" DATE,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datapoint" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "value_numeric" DECIMAL(20,6),
    "value_text" TEXT,
    "unit" TEXT,
    "provenance" "provenance" NOT NULL,
    "label" "data_label" NOT NULL DEFAULT 'human_reviewed',
    "reporting_period" TEXT,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "datapoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datapoint_evidence" (
    "organization_id" UUID NOT NULL,
    "datapoint_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "linked_by_user_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "datapoint_evidence_pkey" PRIMARY KEY ("datapoint_id", "evidence_id")
);

-- CreateTable
CREATE TABLE "evidence_verification" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "verified_by_user_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "evidence_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_organization_id_created_at_idx" ON "document"("organization_id", "created_at");
CREATE INDEX "document_organization_id_checksum_sha256_idx" ON "document"("organization_id", "checksum_sha256");
CREATE INDEX "evidence_organization_id_status_idx" ON "evidence"("organization_id", "status");
CREATE INDEX "evidence_organization_id_type_idx" ON "evidence"("organization_id", "type");
CREATE INDEX "datapoint_organization_id_subject_type_subject_id_idx" ON "datapoint"("organization_id", "subject_type", "subject_id");
CREATE INDEX "datapoint_organization_id_metric_key_idx" ON "datapoint"("organization_id", "metric_key");
CREATE INDEX "datapoint_evidence_organization_id_idx" ON "datapoint_evidence"("organization_id");
CREATE INDEX "datapoint_evidence_evidence_id_idx" ON "datapoint_evidence"("evidence_id");
CREATE INDEX "evidence_verification_organization_id_evidence_id_idx" ON "evidence_verification"("organization_id", "evidence_id");

-- AddForeignKey
ALTER TABLE "supplier_evidence_ref" ADD CONSTRAINT "supplier_evidence_ref_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_evidence_ref" ADD CONSTRAINT "supplier_evidence_ref_promoted_evidence_id_fkey" FOREIGN KEY ("promoted_evidence_id") REFERENCES "evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document" ADD CONSTRAINT "document_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "datapoint" ADD CONSTRAINT "datapoint_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "datapoint_evidence" ADD CONSTRAINT "datapoint_evidence_datapoint_id_fkey" FOREIGN KEY ("datapoint_id") REFERENCES "datapoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "datapoint_evidence" ADD CONSTRAINT "datapoint_evidence_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evidence_verification" ADD CONSTRAINT "evidence_verification_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
