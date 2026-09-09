-- Phase 13c — Usage metering & plan quotas.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "plan" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quotas" JSONB NOT NULL DEFAULT '{}',
    "soft_warn_pct" INTEGER NOT NULL DEFAULT 80,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "subscription" (
    "organization_id" UUID NOT NULL,
    "plan_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_period" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "usage_counter" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "last_event_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usage_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_event" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "route" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usage_counter_organization_id_period_metric_key" ON "usage_counter"("organization_id", "period", "metric");
CREATE INDEX "usage_event_organization_id_occurred_at_idx" ON "usage_event"("organization_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "plan"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "usage_counter" ADD CONSTRAINT "usage_counter_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
