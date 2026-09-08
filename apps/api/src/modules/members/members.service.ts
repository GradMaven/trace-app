import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '@trace/config';
import { AppError } from '@trace/shared';
import { getPrisma, withOrgContext, writeAuditLog } from '@trace/db';
import { hashToken } from '../../common/request-context';
import { EmailService } from '../auth/email.service';

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  status: string;
  roleKeys: string[];
  joinedAt: string;
}

export interface InvitationView {
  id: string;
  email: string;
  roleKeys: string[];
  status: string;
  invitedByUserId: string;
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class MembersService {
  private readonly env = loadEnv();

  constructor(private readonly email: EmailService) {}

  async list(organizationId: string): Promise<MemberView[]> {
    return withOrgContext(organizationId, async (db) => {
      const memberships = await db.membership.findMany({
        include: {
          user: { select: { email: true, name: true } },
          roles: { include: { role: { select: { key: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return memberships.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        status: m.status,
        roleKeys: m.roles.map((r) => r.role.key),
        joinedAt: m.createdAt.toISOString(),
      }));
    });
  }

  async listInvitations(organizationId: string): Promise<InvitationView[]> {
    return withOrgContext(organizationId, async (db) => {
      const invitations = await db.invitation.findMany({ orderBy: { createdAt: 'desc' } });
      return invitations.map(toInvitationView);
    });
  }

  async invite(
    organizationId: string,
    actorUserId: string,
    input: { email: string; roleKeys: string[] },
    requestId: string,
  ): Promise<InvitationView> {
    const prisma = getPrisma();

    return withOrgContext(organizationId, async (db) => {
      const knownRoles = await db.role.findMany({
        where: { organizationId, key: { in: input.roleKeys } },
        select: { key: true },
      });
      const knownKeys = new Set(knownRoles.map((r) => r.key));
      const unknown = input.roleKeys.filter((k) => !knownKeys.has(k));
      if (unknown.length > 0) {
        throw AppError.unprocessable(
          'members.unknown_role',
          `Unknown role(s) for this organization: ${unknown.join(', ')}.`,
        );
      }

      const alreadyMember = await db.membership.findFirst({
        where: { organizationId, user: { email: input.email }, status: 'active' },
      });
      if (alreadyMember) {
        throw AppError.conflict('members.already_member', 'That person is already a member.');
      }

      const existingPending = await db.invitation.findFirst({
        where: { organizationId, email: input.email, status: 'pending' },
      });
      if (existingPending) {
        throw AppError.conflict('members.invitation_pending', 'An invitation is already pending for that address.');
      }

      const invitation = await db.invitation.create({
        data: {
          organizationId,
          email: input.email,
          roleKeys: input.roleKeys,
          invitedByUserId: actorUserId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        },
      });

      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'invitation.created',
        resourceType: 'invitation',
        resourceId: invitation.id,
        before: null,
        after: { email: input.email, roleKeys: input.roleKeys },
        requestId,
      });

      // Magic-link token (invite) lives on the platform table, outside the tenant txn.
      const rawToken = randomBytes(32).toString('base64url');
      await prisma.magicLinkToken.create({
        data: {
          email: input.email,
          tokenHash: hashToken(rawToken),
          purpose: 'invite',
          invitationId: invitation.id,
          expiresAt: new Date(Date.now() + this.env.MAGIC_LINK_TTL_MINUTES * 60_000),
        },
      });
      const url = `${this.env.WEB_ORIGIN}/auth/verify?token=${rawToken}`;
      await this.email.sendMagicLink(input.email, url, 'invite');

      return toInvitationView(invitation);
    });
  }

  async revokeInvitation(
    organizationId: string,
    actorUserId: string,
    invitationId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      const invitation = await db.invitation.findFirst({
        where: { id: invitationId, organizationId },
      });
      if (!invitation) throw AppError.notFound('invitation.not_found', 'Invitation not found.');
      if (invitation.status !== 'pending') {
        throw AppError.conflict('invitation.not_pending', 'Only a pending invitation can be revoked.');
      }
      await db.invitation.update({ where: { id: invitation.id }, data: { status: 'revoked' } });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'invitation.revoked',
        resourceType: 'invitation',
        resourceId: invitation.id,
        before: { status: 'pending' },
        after: { status: 'revoked' },
        requestId,
      });
    });
  }
}

function toInvitationView(i: {
  id: string;
  email: string;
  roleKeys: string[];
  status: string;
  invitedByUserId: string;
  createdAt: Date;
  expiresAt: Date;
}): InvitationView {
  return {
    id: i.id,
    email: i.email,
    roleKeys: i.roleKeys,
    status: i.status,
    invitedByUserId: i.invitedByUserId,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
  };
}
