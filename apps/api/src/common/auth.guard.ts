import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, type Permission } from '@trace/shared';
import { authenticateApiKey, getPrisma } from '@trace/db';
import { resolvePermissions } from '@trace/domain';
import type { RequestWithContext } from './request-context';
import { hashToken } from './request-context';
import { PUBLIC_KEY } from './decorators';

export interface AuthenticatedActor {
  userId: string;
  email: string;
  name: string;
  sessionId: string;
  organizationId: string | null;
  membershipId: string | null;
  /** Set when the active membership is a supplier-portal user scoped to one supplier. */
  supplierId: string | null;
  /** Set when the request authenticated with an API key rather than a session. */
  viaApiKeyId: string | null;
  permissions: Permission[];
}

export const SESSION_COOKIE = 'trace_session';
const ORG_HEADER = 'x-organization-id';
const API_KEY_HEADER = 'x-api-key';

/**
 * Resolves the session cookie into an actor, determines the active organization,
 * loads the actor's permissions for it, and writes all of that into the ambient
 * RequestContext. Runs on every route; `@Public()` routes are allowed through
 * unauthenticated but still get a context if a valid session is present.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context
      .switchToHttp()
      .getRequest<RequestWithContext & { actor?: AuthenticatedActor }>();
    const actor = await this.resolveActor(req);

    if (actor) {
      req.actor = actor;
      req.traceContext.userId = actor.userId;
      req.traceContext.organizationId = actor.organizationId;
      req.traceContext.permissions = actor.permissions;
    }

    if (!actor && !isPublic) {
      throw AppError.unauthenticated();
    }
    return true;
  }

  private async resolveActor(req: RequestWithContext): Promise<AuthenticatedActor | undefined> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!raw) return this.resolveApiKeyActor(req);

    const prisma = getPrisma();
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      return undefined;
    }

    const requestedOrg = firstHeader(req.headers[ORG_HEADER]);
    const activeOrgId = await this.pickOrganization(
      session.userId,
      requestedOrg ?? session.organizationId,
    );

    let membershipId: string | null = null;
    let supplierId: string | null = null;
    let permissions: Permission[] = [];
    if (activeOrgId) {
      const membership = await prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: activeOrgId, userId: session.userId } },
        include: { roles: { include: { role: { include: { permissions: true } } } } },
      });
      if (membership && membership.status === 'active') {
        membershipId = membership.id;
        supplierId = membership.supplierId;
        permissions = resolvePermissions(
          membership.roles.map((mr) => ({
            key: mr.role.key,
            permissions: mr.role.permissions.map((rp) => rp.permissionKey as Permission),
          })),
        ).toArray();
      }
    }

    return {
      userId: session.userId,
      email: session.user.email,
      name: session.user.name,
      sessionId: session.id,
      organizationId: membershipId ? activeOrgId : null,
      membershipId,
      supplierId: membershipId ? supplierId : null,
      viaApiKeyId: null,
      permissions,
    };
  }

  /**
   * API-key authentication (Phase 13). A key resolves to exactly one
   * organization and a scoped, capped permission set (never administrative — see
   * @trace/domain API_KEY_FORBIDDEN_PERMISSIONS). No session, no membership; the
   * responsible user is the key's creator, recorded for the audit trail.
   */
  private async resolveApiKeyActor(
    req: RequestWithContext,
  ): Promise<AuthenticatedActor | undefined> {
    const header = firstHeader(req.headers[API_KEY_HEADER]);
    const bearer = firstHeader(req.headers.authorization);
    const presented =
      header ?? (bearer?.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : undefined);
    if (!presented) return undefined;

    const key = await authenticateApiKey(getPrisma(), presented);
    if (!key) throw AppError.unauthenticated('auth.invalid_api_key', 'Invalid or expired API key.');

    const user = await getPrisma().user.findUnique({ where: { id: key.createdByUserId } });
    return {
      userId: key.createdByUserId,
      email: user?.email ?? 'api-key@trace.internal',
      name: user ? `${user.name} (API key: ${key.name})` : `API key: ${key.name}`,
      sessionId: `apikey:${key.apiKeyId}`,
      organizationId: key.organizationId,
      membershipId: null,
      supplierId: null,
      viaApiKeyId: key.apiKeyId,
      permissions: key.permissions,
    };
  }

  private async pickOrganization(
    userId: string,
    preferred: string | null | undefined,
  ): Promise<string | null> {
    const prisma = getPrisma();
    if (preferred) {
      const m = await prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: preferred, userId } },
        select: { status: true },
      });
      if (m && m.status === 'active') return preferred;
    }
    const any = await prisma.membership.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    return any?.organizationId ?? null;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
