-- Phase 13f — Single sign-on (SAML 2.0).
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- CreateTable
CREATE TABLE "saml_provider" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idp_entity_id" TEXT NOT NULL,
    "sso_url" TEXT NOT NULL,
    "certificates" TEXT[],
    "email_attribute" TEXT,
    "name_attribute" TEXT,
    "groups_attribute" TEXT,
    "want_assertions_signed" BOOLEAN NOT NULL DEFAULT true,
    "role_mapping" JSONB NOT NULL DEFAULT '{}',
    "allowed_email_domains" TEXT[],
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saml_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saml_login_request" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "saml_request_id" TEXT NOT NULL,
    "relay_state" TEXT NOT NULL,
    "redirect_after" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saml_login_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saml_link" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "saml_provider_id" UUID NOT NULL,
    "name_id" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saml_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saml_provider_organization_id_key" ON "saml_provider"("organization_id");
CREATE UNIQUE INDEX "saml_login_request_saml_request_id_key" ON "saml_login_request"("saml_request_id");
CREATE UNIQUE INDEX "saml_login_request_relay_state_key" ON "saml_login_request"("relay_state");
CREATE INDEX "saml_login_request_expires_at_idx" ON "saml_login_request"("expires_at");
CREATE UNIQUE INDEX "saml_link_saml_provider_id_name_id_key" ON "saml_link"("saml_provider_id", "name_id");
CREATE UNIQUE INDEX "saml_link_saml_provider_id_user_id_key" ON "saml_link"("saml_provider_id", "user_id");

-- AddForeignKey
ALTER TABLE "saml_provider" ADD CONSTRAINT "saml_provider_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saml_login_request" ADD CONSTRAINT "saml_login_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saml_link" ADD CONSTRAINT "saml_link_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saml_link" ADD CONSTRAINT "saml_link_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saml_link" ADD CONSTRAINT "saml_link_saml_provider_id_fkey" FOREIGN KEY ("saml_provider_id") REFERENCES "saml_provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
