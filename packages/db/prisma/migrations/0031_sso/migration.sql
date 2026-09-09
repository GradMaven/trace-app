-- Phase 13e — Single sign-on (OpenID Connect).
-- Hand-authored to match schema.prisma (no shadow DB on the dev host).

-- AlterTable
ALTER TABLE "user" ADD COLUMN "external_id" TEXT;

-- CreateTable
CREATE TABLE "identity_provider" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'oidc',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "authorization_endpoint" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "jwks_uri" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'openid email profile',
    "role_mapping" JSONB NOT NULL DEFAULT '{}',
    "allowed_email_domains" TEXT[],
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "identity_provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_login_request" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "pkce_verifier" TEXT NOT NULL,
    "redirect_after" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_login_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_link" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "identity_provider_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_provider_organization_id_key" ON "identity_provider"("organization_id");
CREATE UNIQUE INDEX "sso_login_request_state_key" ON "sso_login_request"("state");
CREATE INDEX "sso_login_request_expires_at_idx" ON "sso_login_request"("expires_at");
CREATE UNIQUE INDEX "sso_link_identity_provider_id_external_id_key" ON "sso_link"("identity_provider_id", "external_id");
CREATE UNIQUE INDEX "sso_link_identity_provider_id_user_id_key" ON "sso_link"("identity_provider_id", "user_id");

-- AddForeignKey
ALTER TABLE "identity_provider" ADD CONSTRAINT "identity_provider_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_login_request" ADD CONSTRAINT "sso_login_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_link" ADD CONSTRAINT "sso_link_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_link" ADD CONSTRAINT "sso_link_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_link" ADD CONSTRAINT "sso_link_identity_provider_id_fkey" FOREIGN KEY ("identity_provider_id") REFERENCES "identity_provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
