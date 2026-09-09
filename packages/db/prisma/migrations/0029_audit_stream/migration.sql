-- Phase 13d — Audit-log streaming + monitoring.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateEnum
CREATE TYPE "audit_stream_status" AS ENUM ('active', 'paused', 'error');
CREATE TYPE "audit_stream_delivery_status" AS ENUM ('pending', 'delivering', 'succeeded', 'failed', 'dead');

-- CreateTable
CREATE TABLE "audit_stream" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "status" "audit_stream_status" NOT NULL DEFAULT 'active',
    "cursor" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "last_delivery_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_stream_delivery" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "from_cursor" TEXT,
    "to_cursor" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "status" "audit_stream_delivery_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "response_status" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_stream_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "component_heartbeat" (
    "component" TEXT NOT NULL,
    "beat_at" TIMESTAMPTZ(6) NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "component_heartbeat_pkey" PRIMARY KEY ("component")
);

-- CreateIndex
CREATE INDEX "audit_stream_organization_id_status_idx" ON "audit_stream"("organization_id", "status");
CREATE INDEX "audit_stream_delivery_organization_id_created_at_idx" ON "audit_stream_delivery"("organization_id", "created_at");
CREATE INDEX "audit_stream_delivery_status_next_attempt_at_idx" ON "audit_stream_delivery"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "audit_stream" ADD CONSTRAINT "audit_stream_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_stream_delivery" ADD CONSTRAINT "audit_stream_delivery_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_stream_delivery" ADD CONSTRAINT "audit_stream_delivery_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "audit_stream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
