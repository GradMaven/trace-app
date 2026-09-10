-- Phase 13h — Billing-provider integration.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "billing_config" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "publishable_key" TEXT,
    "secret_key" TEXT,
    "webhook_secret" TEXT,
    "price_to_plan" JSONB NOT NULL DEFAULT '{}',
    "customer_id" TEXT,
    "subscription_ref" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_event" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "outcome" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_checkout" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_key" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_checkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_config_organization_id_key" ON "billing_config"("organization_id");
CREATE UNIQUE INDEX "billing_event_provider_event_id_key" ON "billing_event"("provider_event_id");
CREATE INDEX "billing_event_organization_id_received_at_idx" ON "billing_event"("organization_id", "received_at");
CREATE INDEX "billing_checkout_organization_id_created_at_idx" ON "billing_checkout"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "billing_config" ADD CONSTRAINT "billing_config_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_event" ADD CONSTRAINT "billing_event_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_checkout" ADD CONSTRAINT "billing_checkout_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
