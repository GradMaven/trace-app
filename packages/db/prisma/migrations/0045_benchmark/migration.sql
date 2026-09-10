-- Phase 14d — Cross-tenant benchmarking.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).
--
-- `benchmark_bucket` is deliberately global — it has no `organization_id` and is
-- NOT row-level-secured. Every row is a k-anonymised sector aggregate that
-- carries no numbers at all until it has >= BENCHMARK_K_ANON contributors, so no
-- organization is identifiable from it. `organization.benchmark_opt_in` gates
-- whether an org's anonymised ratios feed the buckets.

-- AlterTable
ALTER TABLE "organization" ADD COLUMN "sector" TEXT;
ALTER TABLE "organization" ADD COLUMN "benchmark_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "benchmark_bucket" (
    "id" UUID NOT NULL,
    "sector" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "contributors" INTEGER NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "p25" DECIMAL(12,4),
    "median" DECIMAL(12,4),
    "p75" DECIMAL(12,4),
    "min" DECIMAL(12,4),
    "max" DECIMAL(12,4),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_bucket_sector_metric_period_key" ON "benchmark_bucket"("sector", "metric", "period");
CREATE INDEX "benchmark_bucket_sector_period_idx" ON "benchmark_bucket"("sector", "period");
