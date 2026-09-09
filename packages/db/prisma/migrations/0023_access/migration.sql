-- Phase 13 — Enterprise access: API keys, outbound webhooks, custom-role flag.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "webhook_endpoint_status" AS ENUM ('active', 'paused', 'disabled');
CREATE TYPE "webhook_delivery_status" AS ENUM ('pending', 'delivering', 'succeeded', 'failed', 'dead');

-- AlterTable: mark the shipped roles as system roles (custom roles default false).
ALTER TABLE "role" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;
UPDATE "role" SET "is_system" = true
WHERE "key" IN (
  'platform_admin', 'organization_admin', 'sustainability_manager', 'esg_analyst',
  'procurement_manager', 'finance', 'auditor', 'supplier_user'
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "hashed_secret" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "scopes" TEXT[],
    "created_by_user_id" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoint" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "status" "webhook_endpoint_status" NOT NULL DEFAULT 'active',
    "created_by_user_id" UUID NOT NULL,
    "last_success_at" TIMESTAMPTZ(6),
    "last_failure_at" TIMESTAMPTZ(6),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "response_status" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_key_token_prefix_key" ON "api_key"("token_prefix");
CREATE UNIQUE INDEX "api_key_hashed_secret_key" ON "api_key"("hashed_secret");
CREATE INDEX "api_key_organization_id_created_at_idx" ON "api_key"("organization_id", "created_at");
CREATE INDEX "webhook_endpoint_organization_id_status_idx" ON "webhook_endpoint"("organization_id", "status");
CREATE INDEX "webhook_delivery_organization_id_created_at_idx" ON "webhook_delivery"("organization_id", "created_at");
CREATE INDEX "webhook_delivery_status_next_attempt_at_idx" ON "webhook_delivery"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
