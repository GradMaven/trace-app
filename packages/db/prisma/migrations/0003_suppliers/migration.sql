-- Phase 2 — Supplier Intelligence.
-- Hand-authored to match schema.prisma (no shadow DB available on the dev host).
-- CI verifies drift with `prisma migrate diff --exit-code`.

-- CreateEnum
CREATE TYPE "supplier_status" AS ENUM ('active', 'archived');
CREATE TYPE "supplier_request_kind" AS ENUM ('sustainability_questionnaire');
CREATE TYPE "supplier_request_status" AS ENUM ('draft', 'sent', 'in_progress', 'submitted', 'accepted', 'declined');
CREATE TYPE "evidence_type" AS ENUM (
  'supplier_report', 'invoice', 'utility_bill', 'certificate', 'epd', 'lca',
  'audit_report', 'questionnaire', 'erp_record', 'logistics_record', 'contract', 'external_dataset'
);

-- AlterTable
ALTER TABLE "membership" ADD COLUMN "supplier_id" UUID;
ALTER TABLE "invitation" ADD COLUMN "supplier_id" UUID;

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "industry_nace" TEXT,
    "registration_ids" JSONB NOT NULL DEFAULT '{}',
    "status" "supplier_status" NOT NULL DEFAULT 'active',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contact" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_location" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'site',
    "label" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "address" JSONB NOT NULL DEFAULT '{}',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_relationship" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "category" TEXT,
    "tier" INTEGER,
    "annual_spend" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "since" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "supplier_relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_request" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "kind" "supplier_request_kind" NOT NULL DEFAULT 'sustainability_questionnaire',
    "template_version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" "supplier_request_status" NOT NULL DEFAULT 'draft',
    "due_on" DATE,
    "responses" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "supplier_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_evidence_ref" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "request_id" UUID,
    "type" "evidence_type" NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT,
    "note" TEXT,
    "reporting_period" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "submitted_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_evidence_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_passport" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "builder_version" TEXT NOT NULL,
    "completeness" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by_user_id" UUID,

    CONSTRAINT "supplier_passport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_supplier_id_idx" ON "membership"("supplier_id");
CREATE INDEX "invitation_supplier_id_idx" ON "invitation"("supplier_id");
CREATE INDEX "supplier_organization_id_name_idx" ON "supplier"("organization_id", "name");
CREATE INDEX "supplier_organization_id_status_idx" ON "supplier"("organization_id", "status");
CREATE UNIQUE INDEX "supplier_contact_supplier_id_email_key" ON "supplier_contact"("supplier_id", "email");
CREATE INDEX "supplier_contact_organization_id_supplier_id_idx" ON "supplier_contact"("organization_id", "supplier_id");
CREATE INDEX "supplier_location_organization_id_supplier_id_idx" ON "supplier_location"("organization_id", "supplier_id");
CREATE UNIQUE INDEX "supplier_relationship_supplier_id_key" ON "supplier_relationship"("supplier_id");
CREATE INDEX "supplier_relationship_organization_id_idx" ON "supplier_relationship"("organization_id");
CREATE INDEX "supplier_request_organization_id_supplier_id_idx" ON "supplier_request"("organization_id", "supplier_id");
CREATE INDEX "supplier_request_organization_id_status_idx" ON "supplier_request"("organization_id", "status");
CREATE INDEX "supplier_evidence_ref_organization_id_supplier_id_idx" ON "supplier_evidence_ref"("organization_id", "supplier_id");
CREATE UNIQUE INDEX "supplier_passport_supplier_id_version_key" ON "supplier_passport"("supplier_id", "version");
CREATE INDEX "supplier_passport_organization_id_supplier_id_idx" ON "supplier_passport"("organization_id", "supplier_id");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_contact" ADD CONSTRAINT "supplier_contact_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_location" ADD CONSTRAINT "supplier_location_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_relationship" ADD CONSTRAINT "supplier_relationship_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_request" ADD CONSTRAINT "supplier_request_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_evidence_ref" ADD CONSTRAINT "supplier_evidence_ref_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_evidence_ref" ADD CONSTRAINT "supplier_evidence_ref_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "supplier_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_passport" ADD CONSTRAINT "supplier_passport_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
