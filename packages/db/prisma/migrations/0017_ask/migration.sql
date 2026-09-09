-- Phase 10 — Ask TRACE.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "ask_query" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "reporting_period" TEXT,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "answer" TEXT NOT NULL DEFAULT '',
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "ai_job_ids" UUID[],
    "provider" TEXT,
    "model" TEXT,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_eur" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "asked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_query_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ask_query_organization_id_created_at_idx" ON "ask_query"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "ask_query" ADD CONSTRAINT "ask_query_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
