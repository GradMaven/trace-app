import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@trace/config';
import { AppError, type RoleKey } from '@trace/shared';
import { getPrisma, withOrgContext, writeAuditLog } from '@trace/db';
import type { Response } from 'express';
import { hashToken } from '../../common/request-context';
import { SESSION_COOKIE } from '../../common/auth.guard';
import { CSRF_COOKIE } from '../../common/csrf.guard';
import { EmailService } from './email.service';

interface VerifyResult {
  userId: string;
  email: string;
  name: string;
  acceptedInvitations: string[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly env = loadEnv();

  constructor(private readonly email: EmailService) {}

  /** Always succeeds from the caller's view — no account enumeration. */
  async requestMagicLink(email: string, requestId: string): Promise<void> {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { email } });
    const pendingInvite = await prisma.invitation.findFirst({
      where: { email, status: 'pending', expiresAt: { gt: new Date() } },
    });

    if (!user && !pendingInvite) {
      this.logger.warn(`Magic-link requested for unknown address (request ${requestId}).`);
      return; // silent
    }

    const rawToken = randomBytes(32).toString('base64url');
    const purpose = user ? 'login' : 'invite';
    await prisma.magicLinkToken.create({
      data: {
        email,
        tokenHash: hashToken(rawToken),
        purpose,
        invitationId: user ? null : (pendingInvite?.id ?? null),
        expiresAt: new Date(Date.now() + this.env.MAGIC_LINK_TTL_MINUTES * 60_000),
      },
    });

    const url = `${this.env.WEB_ORIGIN}/auth/verify?token=${rawToken}`;
    await this.email.sendMagicLink(email, url, purpose);
  }

  async verifyMagicLink(rawToken: string, res: Response, requestId: string): Promise<VerifyResult> {
    const prisma = getPrisma();
    const token = await prisma.magicLinkToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });

    if (!token || token.consumedAt || token.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthenticated('auth.invalid_token', 'This sign-in link is invalid or has expired.');
    }
    await prisma.magicLinkToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });

    let user = await prisma.user.findUnique({ where: { email: token.email } });
    const acceptedInvitations: string[] = [];

    if (!user) {
      // First sign-in via an invitation.
      const invitations = await prisma.invitation.findMany({
        where: { email: token.email, status: 'pending', expiresAt: { gt: new Date() } },
      });
      if (invitations.length === 0) {
        throw AppError.unauthenticated('auth.no_account', 'No account or invitation for this address.');
      }
      user = await prisma.user.create({
        data: { id: randomUUID(), email: token.email, name: nameFromEmail(token.email) },
      });
      for (const invite of invitations) {
        await this.acceptInvitation(invite.id, user.id, requestId);
        acceptedInvitations.push(invite.id);
      }
    } else {
      // Existing user may also have fresh invitations waiting.
      const invitations = await prisma.invitation.findMany({
        where: { email: user.email, status: 'pending', expiresAt: { gt: new Date() } },
      });
      for (const invite of invitations) {
        await this.acceptInvitation(invite.id, user.id, requestId);
        acceptedInvitations.push(invite.id);
      }
    }

    await this.createSession(user.id, res, requestId);
    return { userId: user.id, email: user.email, name: user.name, acceptedInvitations };
  }

  async createSession(userId: string, res: Response, requestId: string): Promise<void> {
    const prisma = getPrisma();
    const firstMembership = await prisma.membership.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });

    const rawSession = randomBytes(32).toString('base64url');
    const rawCsrf = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);

    await prisma.session.create({
      data: {
        userId,
        organizationId: firstMembership?.organizationId ?? null,
        tokenHash: hashToken(rawSession),
        expiresAt,
      },
    });

    this.setCookies(res, rawSession, rawCsrf, expiresAt);
    this.logger.log(`Session created for user ${userId} (request ${requestId}).`);
  }

  async logout(sessionId: string | null, res: Response): Promise<void> {
    if (sessionId) {
      await getPrisma().session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.clearCookies(res);
  }

  async switchOrganization(userId: string, sessionId: string, organizationId: string): Promise<void> {
    const prisma = getPrisma();
    const membership = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { status: true },
    });
    if (!membership || membership.status !== 'active') {
      throw AppError.notFound('organization.not_found', 'Organization not found.');
    }
    await prisma.session.update({ where: { id: sessionId }, data: { organizationId } });
  }

  private async acceptInvitation(invitationId: string, userId: string, requestId: string): Promise<void> {
    const prisma = getPrisma();
    const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.status !== 'pending') return;

    await withOrgContext(invitation.organizationId, async (db) => {
      const roles = await db.role.findMany({
        where: { organizationId: invitation.organizationId, key: { in: invitation.roleKeys } },
        select: { id: true },
      });

      const existing = await db.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId },
        },
      });

      if (existing) {
        await db.membership.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            ...(invitation.supplierId ? { supplierId: invitation.supplierId } : {}),
            roles: {
              connectOrCreate: roles.map((r) => ({
                where: { membershipId_roleId: { membershipId: existing.id, roleId: r.id } },
                create: { roleId: r.id },
              })),
            },
          },
        });
      } else {
        await db.membership.create({
          data: {
            organizationId: invitation.organizationId,
            userId,
            status: 'active',
            supplierId: invitation.supplierId,
            roles: { create: roles.map((r) => ({ roleId: r.id })) },
          },
        });
      }

      await db.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });

      await writeAuditLog(db, {
        organizationId: invitation.organizationId,
        actorId: userId,
        action: 'invitation.accepted',
        resourceType: 'invitation',
        resourceId: invitation.id,
        before: { status: 'pending' },
        after: { status: 'accepted', roleKeys: invitation.roleKeys as RoleKey[] },
        requestId,
      });
    });
  }

  private setCookies(res: Response, session: string, csrf: string, expiresAt: Date): void {
    const secure = this.env.NODE_ENV === 'production';
    res.cookie(SESSION_COOKIE, session, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    res.cookie(CSRF_COOKIE, csrf, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private clearCookies(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
