-- Phase 13g — SCIM 2.0 provisioning.
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "scim_config" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "token_hash" TEXT,
    "token_prefix" TEXT,
    "default_roles" TEXT[],
    "group_role_mapping" JSONB NOT NULL DEFAULT '{}',
    "last_request_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scim_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_user" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_id" TEXT,
    "user_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "given_name" TEXT,
    "family_name" TEXT,
    "display_name" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scim_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_group" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_id" TEXT,
    "display_name" TEXT NOT NULL,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scim_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_group_member" (
    "scim_group_id" UUID NOT NULL,
    "scim_user_id" UUID NOT NULL,

    CONSTRAINT "scim_group_member_pkey" PRIMARY KEY ("scim_group_id", "scim_user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scim_config_organization_id_key" ON "scim_config"("organization_id");
CREATE UNIQUE INDEX "scim_user_organization_id_user_name_key" ON "scim_user"("organization_id", "user_name");
CREATE UNIQUE INDEX "scim_user_organization_id_external_id_key" ON "scim_user"("organization_id", "external_id");
CREATE UNIQUE INDEX "scim_user_organization_id_user_id_key" ON "scim_user"("organization_id", "user_id");
CREATE UNIQUE INDEX "scim_group_organization_id_display_name_key" ON "scim_group"("organization_id", "display_name");
CREATE UNIQUE INDEX "scim_group_organization_id_external_id_key" ON "scim_group"("organization_id", "external_id");
CREATE INDEX "scim_group_member_scim_user_id_idx" ON "scim_group_member"("scim_user_id");

-- AddForeignKey
ALTER TABLE "scim_config" ADD CONSTRAINT "scim_config_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scim_user" ADD CONSTRAINT "scim_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_scim_group_id_fkey" FOREIGN KEY ("scim_group_id") REFERENCES "scim_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scim_group_member" ADD CONSTRAINT "scim_group_member_scim_user_id_fkey" FOREIGN KEY ("scim_user_id") REFERENCES "scim_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
