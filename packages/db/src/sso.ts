import {
  buildAuthorizationUrl,
  emailDomainAllowed,
  generatePkce,
  mapClaimsToRoleKeys,
  OIDC_DEFAULT_SCOPES,
  OIDC_LOGIN_TTL_SECONDS,
  randomUrlToken,
  verifyIdToken,
  type IdTokenClaims,
  type Jwks,
  type OidcRoleMapping,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { withOrgContext, type PrismaClient, type TenantDb } from './client';
import { writeAuditLog } from './audit';

/**
 * OpenID Connect SSO with just-in-time provisioning (Phase 13e).
 *
 * `identity_provider` / `sso_link` are RLS-forced. The login flow runs pre-auth,
 * so it resolves the org (from the URL slug, then from the single-use
 * `sso_login_request` row — that table is not RLS'd, like `magic_link_token`)
 * and then opens `withOrgContext` to touch the RLS'd tables.
 */

// ---------------------------------------------------------------------------
// Provider configuration (org-scoped, admin)
// ---------------------------------------------------------------------------

export interface IdentityProviderConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** Omit on an update to keep the stored secret. Required on first configuration. */
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  scopes?: string;
  roleMapping: OidcRoleMapping;
  allowedEmailDomains?: string[];
}

function assertHttps(url: string, field: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw AppError.unprocessable('sso.bad_url', `${field} is not a valid URL.`);
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') {
    throw AppError.unprocessable('sso.insecure_url', `${field} must use https.`);
  }
  return u.toString();
}

export async function upsertIdentityProvider(
  db: TenantDb,
  args: {
    organizationId: string;
    config: IdentityProviderConfig;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  const c = args.config;
  if (!c.clientId.trim()) {
    throw AppError.unprocessable('sso.missing_client', 'Client ID is required.');
  }
  const existingProvider = await db.identityProvider.findUnique({
    where: { organizationId: args.organizationId },
  });
  const clientSecret = c.clientSecret?.trim() || existingProvider?.clientSecret;
  if (!clientSecret) {
    throw AppError.unprocessable('sso.missing_secret', 'Client secret is required.');
  }
  if (!Array.isArray(c.roleMapping?.defaultRoles) || c.roleMapping.defaultRoles.length === 0) {
    throw AppError.unprocessable(
      'sso.no_default_roles',
      'The role mapping needs at least one default role.',
    );
  }
  const knownRoles = await db.role.findMany({
    where: { organizationId: args.organizationId },
    select: { key: true },
  });
  const knownKeys = new Set(knownRoles.map((r) => r.key));
  const allMapped = [
    ...c.roleMapping.defaultRoles,
    ...Object.values(c.roleMapping.emailDomainRoles ?? {}).flat(),
    ...Object.values(c.roleMapping.groupRoles ?? {}).flat(),
  ];
  const unknown = allMapped.filter((k) => !knownKeys.has(k));
  if (unknown.length > 0) {
    throw AppError.unprocessable(
      'sso.unknown_role',
      `Role mapping references unknown role(s): ${[...new Set(unknown)].join(', ')}.`,
    );
  }

  const data = {
    issuer: assertHttps(c.issuer, 'Issuer'),
    clientId: c.clientId.trim(),
    clientSecret,
    authorizationEndpoint: assertHttps(c.authorizationEndpoint, 'Authorization endpoint'),
    tokenEndpoint: assertHttps(c.tokenEndpoint, 'Token endpoint'),
    jwksUri: assertHttps(c.jwksUri, 'JWKS URI'),
    scopes: (c.scopes || OIDC_DEFAULT_SCOPES).trim(),
    roleMapping: c.roleMapping as unknown as object,
    allowedEmailDomains: (c.allowedEmailDomains ?? [])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    enabled: c.enabled,
  };

  const row = await db.identityProvider.upsert({
    where: { organizationId: args.organizationId },
    create: {
      organizationId: args.organizationId,
      protocol: 'oidc',
      createdByUserId: args.actorUserId,
      ...data,
    },
    update: data,
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: existingProvider ? 'sso.provider_updated' : 'sso.provider_configured',
    resourceType: 'identity_provider',
    resourceId: row.id,
    before: existingProvider
      ? { issuer: existingProvider.issuer, enabled: existingProvider.enabled }
      : null,
    after: { issuer: data.issuer, enabled: data.enabled },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export interface IdentityProviderView {
  id: string;
  protocol: string;
  enabled: boolean;
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  scopes: string;
  roleMapping: OidcRoleMapping;
  allowedEmailDomains: string[];
  linkedMembers: number;
  /** The redirect URI the org must register at the IdP. */
  createdAt: string;
}

export async function getIdentityProvider(
  db: TenantDb,
  organizationId: string,
): Promise<IdentityProviderView | null> {
  const row = await db.identityProvider.findUnique({
    where: { organizationId },
    include: { _count: { select: { links: true } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    protocol: row.protocol,
    enabled: row.enabled,
    issuer: row.issuer,
    clientId: row.clientId,
    authorizationEndpoint: row.authorizationEndpoint,
    tokenEndpoint: row.tokenEndpoint,
    jwksUri: row.jwksUri,
    scopes: row.scopes,
    roleMapping: row.roleMapping as unknown as OidcRoleMapping,
    allowedEmailDomains: row.allowedEmailDomains,
    linkedMembers: row._count.links,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteIdentityProvider(
  db: TenantDb,
  args: { organizationId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.identityProvider.findUnique({
    where: { organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('sso.not_configured', 'No identity provider is configured.');
  await db.identityProvider.delete({ where: { id: row.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'sso.provider_removed',
    resourceType: 'identity_provider',
    resourceId: row.id,
    before: { issuer: row.issuer },
    after: null,
    requestId: args.requestId,
  });
}

// ---------------------------------------------------------------------------
// Login flow (pre-auth)
// ---------------------------------------------------------------------------

export interface BeginSsoLoginArgs {
  orgSlug: string;
  redirectUri: string;
  redirectAfter?: string;
  now?: Date;
}

export async function beginSsoLogin(
  prisma: PrismaClient,
  args: BeginSsoLoginArgs,
): Promise<{ authorizationUrl: string }> {
  const org = await prisma.organization.findUnique({
    where: { slug: args.orgSlug.trim().toLowerCase() },
  });
  if (!org) throw AppError.notFound('sso.org_not_found', 'No workspace with that identifier.');

  const provider = await withOrgContext(
    org.id,
    (db) => db.identityProvider.findUnique({ where: { organizationId: org.id } }),
    prisma,
  );
  if (!provider || !provider.enabled) {
    throw AppError.unprocessable(
      'sso.not_enabled',
      'Single sign-on is not enabled for this workspace.',
    );
  }

  const now = args.now ?? new Date();
  const pkce = generatePkce();
  const state = randomUrlToken(32);
  const nonce = randomUrlToken(24);
  await prisma.ssoLoginRequest.create({
    data: {
      organizationId: org.id,
      state,
      nonce,
      pkceVerifier: pkce.verifier,
      redirectAfter: args.redirectAfter?.slice(0, 512) ?? null,
      expiresAt: new Date(now.getTime() + OIDC_LOGIN_TTL_SECONDS * 1000),
    },
  });

  return {
    authorizationUrl: buildAuthorizationUrl({
      authorizationEndpoint: provider.authorizationEndpoint,
      clientId: provider.clientId,
      redirectUri: args.redirectUri,
      scope: provider.scopes,
      state,
      nonce,
      codeChallenge: pkce.challenge,
    }),
  };
}

export interface CompleteSsoLoginDeps {
  exchangeCode: (input: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }) => Promise<{ id_token?: string }>;
  fetchJwks: (jwksUri: string) => Promise<Jwks>;
  now?: Date;
}

export interface CompleteSsoLoginArgs {
  state: string;
  code: string;
  redirectUri: string;
  requestId: string;
}

export interface CompleteSsoLoginResult {
  userId: string;
  organizationId: string;
  roleKeys: string[];
  provisioned: boolean;
  redirectAfter: string | null;
}

export async function completeSsoLogin(
  prisma: PrismaClient,
  deps: CompleteSsoLoginDeps,
  args: CompleteSsoLoginArgs,
): Promise<CompleteSsoLoginResult> {
  const now = deps.now ?? new Date();
  const loginReq = await prisma.ssoLoginRequest.findUnique({ where: { state: args.state } });
  if (!loginReq || loginReq.consumedAt || loginReq.expiresAt.getTime() < now.getTime()) {
    throw AppError.unauthenticated(
      'sso.invalid_state',
      'This sign-in attempt is invalid or expired.',
    );
  }
  await prisma.ssoLoginRequest.update({ where: { id: loginReq.id }, data: { consumedAt: now } });

  const provider = await withOrgContext(
    loginReq.organizationId,
    (db) => db.identityProvider.findUnique({ where: { organizationId: loginReq.organizationId } }),
    prisma,
  );
  if (!provider || !provider.enabled) {
    throw AppError.unprocessable(
      'sso.not_enabled',
      'Single sign-on is not enabled for this workspace.',
    );
  }

  const tokenResponse = await deps.exchangeCode({
    tokenEndpoint: provider.tokenEndpoint,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    code: args.code,
    redirectUri: args.redirectUri,
    codeVerifier: loginReq.pkceVerifier,
  });
  if (!tokenResponse.id_token) {
    throw AppError.unauthenticated(
      'sso.no_id_token',
      'The identity provider did not return an ID token.',
    );
  }

  const jwks = await deps.fetchJwks(provider.jwksUri);
  const verified = verifyIdToken(tokenResponse.id_token, {
    jwks,
    issuer: provider.issuer,
    audience: provider.clientId,
    nonce: loginReq.nonce,
    now,
  });
  if (!verified.ok) {
    throw AppError.unauthenticated('sso.token_rejected', `ID token rejected: ${verified.reason}.`);
  }
  const claims: IdTokenClaims = verified.claims;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email) {
    throw AppError.unprocessable('sso.no_email', 'The ID token has no email claim.');
  }
  if (!emailDomainAllowed(email, provider.allowedEmailDomains)) {
    throw AppError.forbidden(
      'sso.email_not_allowed',
      'That email domain is not permitted to sign in to this workspace.',
    );
  }

  const roleKeys = mapClaimsToRoleKeys(
    { ...claims, email },
    provider.roleMapping as unknown as OidcRoleMapping,
  );

  // Upsert the platform-level user (email is the key). `user` is not RLS'd.
  const name =
    typeof claims.name === 'string' && claims.name.trim()
      ? claims.name.trim()
      : nameFromEmail(email);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, externalId: claims.sub },
    update: { externalId: claims.sub, ...(claims.name ? { name } : {}) },
  });

  const provisioned = await withOrgContext(
    loginReq.organizationId,
    async (db) => {
      const roles = await db.role.findMany({
        where: { organizationId: loginReq.organizationId, key: { in: roleKeys } },
        select: { id: true, key: true },
      });
      if (roles.length === 0) {
        throw AppError.unprocessable(
          'sso.no_roles',
          'The role mapping produced no valid roles for this workspace.',
        );
      }

      await db.ssoLink.upsert({
        where: {
          identityProviderId_externalId: {
            identityProviderId: provider.id,
            externalId: claims.sub,
          },
        },
        create: {
          organizationId: loginReq.organizationId,
          userId: user.id,
          identityProviderId: provider.id,
          externalId: claims.sub,
        },
        update: { lastLoginAt: now, userId: user.id },
      });

      const membership = await db.membership.findFirst({
        where: { organizationId: loginReq.organizationId, userId: user.id },
      });
      let didProvision = false;
      if (!membership) {
        await db.membership.create({
          data: {
            organizationId: loginReq.organizationId,
            userId: user.id,
            status: 'active',
            roles: { create: roles.map((r) => ({ roleId: r.id })) },
          },
        });
        didProvision = true;
      } else if (membership.status !== 'active') {
        await db.membership.update({ where: { id: membership.id }, data: { status: 'active' } });
      }

      await writeAuditLog(db, {
        organizationId: loginReq.organizationId,
        actorId: user.id,
        action: didProvision ? 'sso.member_provisioned' : 'sso.login',
        resourceType: 'membership',
        resourceId: user.id,
        before: null,
        after: {
          via: 'oidc',
          roleKeys: didProvision ? roles.map((r) => r.key) : undefined,
          sub: claims.sub,
        },
        requestId: args.requestId,
      });
      return didProvision;
    },
    prisma,
  );

  return {
    userId: user.id,
    organizationId: loginReq.organizationId,
    roleKeys,
    provisioned,
    redirectAfter: loginReq.redirectAfter,
  };
}

export async function listSsoLinks(
  db: TenantDb,
  organizationId: string,
): Promise<Array<{ userId: string; externalId: string; lastLoginAt: string }>> {
  const rows = await db.ssoLink.findMany({
    where: { organizationId },
    orderBy: { lastLoginAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({
    userId: r.userId,
    externalId: r.externalId,
    lastLoginAt: r.lastLoginAt.toISOString(),
  }));
}

/** Housekeeping: drop expired / consumed login requests. */
export async function pruneSsoLoginRequests(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.ssoLoginRequest.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
  });
  return res.count;
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
