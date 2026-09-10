import { X509Certificate, createPublicKey } from 'node:crypto';
import {
  buildAuthnRequestXml,
  buildRedirectBindingUrl,
  emailDomainAllowed,
  extractSamlIdentity,
  generateRelayState,
  generateSamlId,
  mapSamlToRoleKeys,
  normalizeCertificatePem,
  SAML_LOGIN_TTL_SECONDS,
  verifySamlResponse,
  type OidcRoleMapping,
  type SamlAttributeMapping,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { withOrgContext, type PrismaClient, type TenantDb } from './client';
import { writeAuditLog } from './audit';

/**
 * SAML 2.0 SSO with just-in-time provisioning (Phase 13f). Parallel to
 * `sso.ts` (OIDC): `saml_provider` / `saml_link` are RLS-forced; the login flow
 * runs pre-auth, so it resolves the org (from the URL slug, then the single-use
 * `saml_login_request` row — not RLS'd, like `sso_login_request`) and then opens
 * `withOrgContext` to touch the RLS'd tables.
 *
 * The XML-DSig verification and every assertion check live in
 * `@trace/domain/access/saml.ts`; this module does no crypto of its own and,
 * because the IdP delivers the assertion straight to the ACS on the POST
 * binding, has no back-channel I/O to inject.
 */

// ---------------------------------------------------------------------------
// Provider configuration (org-scoped, admin)
// ---------------------------------------------------------------------------

export interface SamlProviderConfig {
  enabled: boolean;
  idpEntityId: string;
  ssoUrl: string;
  /** IdP signing certificate(s): PEM cert or bare base64 X.509 body. */
  certificates: string[];
  emailAttribute?: string | null;
  nameAttribute?: string | null;
  groupsAttribute?: string | null;
  wantAssertionsSigned?: boolean;
  roleMapping: OidcRoleMapping;
  allowedEmailDomains?: string[];
}

function assertHttps(url: string, field: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw AppError.unprocessable('saml.bad_url', `${field} is not a valid URL.`);
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') {
    throw AppError.unprocessable('saml.insecure_url', `${field} must use https.`);
  }
  return u.toString();
}

/** Normalise + sanity-check a signing certificate; returns the PEM to store. */
function normalizeAndValidateCert(raw: string): string {
  const pem = normalizeCertificatePem(raw);
  try {
    if (pem.includes('BEGIN CERTIFICATE')) {
      void new X509Certificate(pem);
    } else {
      createPublicKey(pem);
    }
  } catch {
    throw AppError.unprocessable(
      'saml.bad_certificate',
      'One of the signing certificates is not a valid X.509 certificate or public key.',
    );
  }
  return pem;
}

export async function upsertSamlProvider(
  db: TenantDb,
  args: {
    organizationId: string;
    config: SamlProviderConfig;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  const c = args.config;
  if (!c.idpEntityId.trim()) {
    throw AppError.unprocessable('saml.missing_entity_id', 'The IdP entity ID is required.');
  }
  const certs = (c.certificates ?? []).map((s) => s.trim()).filter(Boolean);
  if (certs.length === 0) {
    throw AppError.unprocessable(
      'saml.no_certificate',
      'At least one IdP signing certificate is required.',
    );
  }
  const normalizedCerts = certs.map(normalizeAndValidateCert);

  if (!Array.isArray(c.roleMapping?.defaultRoles) || c.roleMapping.defaultRoles.length === 0) {
    throw AppError.unprocessable(
      'saml.no_default_roles',
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
      'saml.unknown_role',
      `Role mapping references unknown role(s): ${[...new Set(unknown)].join(', ')}.`,
    );
  }

  const existing = await db.samlProvider.findUnique({
    where: { organizationId: args.organizationId },
  });

  const data = {
    idpEntityId: c.idpEntityId.trim(),
    ssoUrl: assertHttps(c.ssoUrl, 'SSO URL'),
    certificates: normalizedCerts,
    emailAttribute: c.emailAttribute?.trim() || null,
    nameAttribute: c.nameAttribute?.trim() || null,
    groupsAttribute: c.groupsAttribute?.trim() || null,
    wantAssertionsSigned: c.wantAssertionsSigned ?? true,
    roleMapping: c.roleMapping as unknown as object,
    allowedEmailDomains: (c.allowedEmailDomains ?? [])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    enabled: c.enabled,
  };

  const row = await db.samlProvider.upsert({
    where: { organizationId: args.organizationId },
    create: {
      organizationId: args.organizationId,
      createdByUserId: args.actorUserId,
      ...data,
    },
    update: data,
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: existing ? 'saml.provider_updated' : 'saml.provider_configured',
    resourceType: 'saml_provider',
    resourceId: row.id,
    before: existing
      ? { idpEntityId: existing.idpEntityId, enabled: existing.enabled }
      : null,
    after: { idpEntityId: data.idpEntityId, enabled: data.enabled },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export interface SamlProviderView {
  id: string;
  enabled: boolean;
  idpEntityId: string;
  ssoUrl: string;
  certificates: string[];
  emailAttribute: string | null;
  nameAttribute: string | null;
  groupsAttribute: string | null;
  wantAssertionsSigned: boolean;
  roleMapping: OidcRoleMapping;
  allowedEmailDomains: string[];
  linkedMembers: number;
  createdAt: string;
}

export async function getSamlProvider(
  db: TenantDb,
  organizationId: string,
): Promise<SamlProviderView | null> {
  const row = await db.samlProvider.findUnique({
    where: { organizationId },
    include: { _count: { select: { links: true } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    enabled: row.enabled,
    idpEntityId: row.idpEntityId,
    ssoUrl: row.ssoUrl,
    certificates: row.certificates,
    emailAttribute: row.emailAttribute,
    nameAttribute: row.nameAttribute,
    groupsAttribute: row.groupsAttribute,
    wantAssertionsSigned: row.wantAssertionsSigned,
    roleMapping: row.roleMapping as unknown as OidcRoleMapping,
    allowedEmailDomains: row.allowedEmailDomains,
    linkedMembers: row._count.links,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteSamlProvider(
  db: TenantDb,
  args: { organizationId: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.samlProvider.findUnique({
    where: { organizationId: args.organizationId },
  });
  if (!row) {
    throw AppError.notFound('saml.not_configured', 'No SAML provider is configured.');
  }
  await db.samlProvider.delete({ where: { id: row.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'saml.provider_removed',
    resourceType: 'saml_provider',
    resourceId: row.id,
    before: { idpEntityId: row.idpEntityId },
    after: null,
    requestId: args.requestId,
  });
}

// ---------------------------------------------------------------------------
// Login flow (pre-auth)
// ---------------------------------------------------------------------------

export interface BeginSamlLoginArgs {
  orgSlug: string;
  /** Our ACS URL — goes into the AuthnRequest and is checked at the callback. */
  acsUrl: string;
  /** Our SP entityID. */
  spEntityId: string;
  redirectAfter?: string;
  now?: Date;
}

export async function beginSamlLogin(
  prisma: PrismaClient,
  args: BeginSamlLoginArgs,
): Promise<{ redirectUrl: string }> {
  const org = await prisma.organization.findUnique({
    where: { slug: args.orgSlug.trim().toLowerCase() },
  });
  if (!org) throw AppError.notFound('saml.org_not_found', 'No workspace with that identifier.');

  const provider = await withOrgContext(
    org.id,
    (db) => db.samlProvider.findUnique({ where: { organizationId: org.id } }),
    prisma,
  );
  if (!provider || !provider.enabled) {
    throw AppError.unprocessable(
      'saml.not_enabled',
      'SAML single sign-on is not enabled for this workspace.',
    );
  }

  const now = args.now ?? new Date();
  const requestId = generateSamlId();
  const relayState = generateRelayState();
  await prisma.samlLoginRequest.create({
    data: {
      organizationId: org.id,
      samlRequestId: requestId,
      relayState,
      redirectAfter: args.redirectAfter?.slice(0, 512) ?? null,
      expiresAt: new Date(now.getTime() + SAML_LOGIN_TTL_SECONDS * 1000),
    },
  });

  const authnRequest = buildAuthnRequestXml({
    spEntityId: args.spEntityId,
    acsUrl: args.acsUrl,
    idpSsoUrl: provider.ssoUrl,
    requestId,
    issueInstant: now,
  });
  return {
    redirectUrl: buildRedirectBindingUrl(provider.ssoUrl, authnRequest, relayState),
  };
}

export interface CompleteSamlLoginArgs {
  /** Base64 `SAMLResponse` from the HTTP-POST binding. */
  samlResponse: string;
  relayState: string;
  /** Our ACS URL (must match what the assertion was issued for). */
  acsUrl: string;
  /** Our SP entityID (the assertion audience). */
  spEntityId: string;
  requestId: string;
  now?: Date;
}

export interface CompleteSamlLoginResult {
  userId: string;
  organizationId: string;
  roleKeys: string[];
  provisioned: boolean;
  redirectAfter: string | null;
}

export async function completeSamlLogin(
  prisma: PrismaClient,
  args: CompleteSamlLoginArgs,
): Promise<CompleteSamlLoginResult> {
  const now = args.now ?? new Date();

  const loginReq = await prisma.samlLoginRequest.findUnique({
    where: { relayState: args.relayState },
  });
  if (!loginReq || loginReq.consumedAt || loginReq.expiresAt.getTime() < now.getTime()) {
    throw AppError.unauthenticated(
      'saml.invalid_state',
      'This sign-in attempt is invalid or expired.',
    );
  }
  await prisma.samlLoginRequest.update({
    where: { id: loginReq.id },
    data: { consumedAt: now },
  });

  const provider = await withOrgContext(
    loginReq.organizationId,
    (db) => db.samlProvider.findUnique({ where: { organizationId: loginReq.organizationId } }),
    prisma,
  );
  if (!provider || !provider.enabled) {
    throw AppError.unprocessable(
      'saml.not_enabled',
      'SAML single sign-on is not enabled for this workspace.',
    );
  }

  let xml: string;
  try {
    xml = Buffer.from(args.samlResponse, 'base64').toString('utf8');
  } catch {
    throw AppError.unprocessable('saml.bad_response', 'The SAMLResponse is not valid base64.');
  }

  const verified = verifySamlResponse(xml, {
    certificatesPem: provider.certificates,
    spEntityId: args.spEntityId,
    acsUrl: args.acsUrl,
    expectedInResponseTo: loginReq.samlRequestId,
    idpEntityId: provider.idpEntityId,
    wantAssertionsSigned: provider.wantAssertionsSigned,
    now,
  });
  if (!verified.ok) {
    throw AppError.unauthenticated(
      'saml.response_rejected',
      `SAML response rejected: ${verified.reason}.`,
    );
  }

  const attributeMapping: SamlAttributeMapping = {
    emailAttribute: provider.emailAttribute ?? undefined,
    nameAttribute: provider.nameAttribute ?? undefined,
    groupsAttribute: provider.groupsAttribute ?? undefined,
  };
  const identity = extractSamlIdentity(verified, attributeMapping);
  if (!identity.email) {
    throw AppError.unprocessable(
      'saml.no_email',
      'The assertion carries no email attribute and the NameID is not an email address.',
    );
  }
  if (!emailDomainAllowed(identity.email, provider.allowedEmailDomains)) {
    throw AppError.forbidden(
      'saml.email_not_allowed',
      'That email domain is not permitted to sign in to this workspace.',
    );
  }

  const roleKeys = mapSamlToRoleKeys(
    identity.email,
    identity.groups,
    provider.roleMapping as unknown as OidcRoleMapping,
  );

  const user = await prisma.user.upsert({
    where: { email: identity.email },
    create: { email: identity.email, name: identity.name, externalId: verified.nameId },
    update: { externalId: verified.nameId, ...(identity.name ? { name: identity.name } : {}) },
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
          'saml.no_roles',
          'The role mapping produced no valid roles for this workspace.',
        );
      }

      await db.samlLink.upsert({
        where: {
          samlProviderId_nameId: {
            samlProviderId: provider.id,
            nameId: verified.nameId,
          },
        },
        create: {
          organizationId: loginReq.organizationId,
          userId: user.id,
          samlProviderId: provider.id,
          nameId: verified.nameId,
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
        await db.membership.update({
          where: { id: membership.id },
          data: { status: 'active' },
        });
      }

      await writeAuditLog(db, {
        organizationId: loginReq.organizationId,
        actorId: user.id,
        action: didProvision ? 'saml.member_provisioned' : 'saml.login',
        resourceType: 'membership',
        resourceId: user.id,
        before: null,
        after: {
          via: 'saml',
          roleKeys: didProvision ? roles.map((r) => r.key) : undefined,
          nameId: verified.nameId,
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

export async function listSamlLinks(
  db: TenantDb,
  organizationId: string,
): Promise<Array<{ userId: string; nameId: string; lastLoginAt: string }>> {
  const rows = await db.samlLink.findMany({
    where: { organizationId },
    orderBy: { lastLoginAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({
    userId: r.userId,
    nameId: r.nameId,
    lastLoginAt: r.lastLoginAt.toISOString(),
  }));
}

/** Housekeeping: drop expired / consumed SAML login requests. */
export async function pruneSamlLoginRequests(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.samlLoginRequest.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
  });
  return res.count;
}
