import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '@trace/config';
import { AppError } from '@trace/shared';
import { getPrisma, withOrgContext, writeAuditLog } from '@trace/db';
import { hashToken } from '../../common/request-context';
import { EmailService } from '../auth/email.service';

export interface SupplierInvitationView {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

@Injectable()
export class SupplierInvitationsService {
  private readonly env = loadEnv();

  constructor(private readonly email: EmailService) {}

  async list(organizationId: string, supplierId: string): Promise<SupplierInvitationView[]> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.invitation.findMany({
        where: { organizationId, supplierId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((i) => ({
        id: i.id,
        email: i.email,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      }));
    });
  }

  async invite(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    email: string,
    requestId: string,
  ): Promise<SupplierInvitationView> {
    const prisma = getPrisma();

    return withOrgContext(organizationId, async (db) => {
      const supplier = await db.supplier.findFirst({
        where: { id: supplierId, organizationId, deletedAt: null },
      });
      if (!supplier) throw AppError.notFound('supplier.not_found', 'Supplier not found.');

      const pending = await db.invitation.findFirst({
        where: { organizationId, supplierId, email, status: 'pending' },
      });
      if (pending) {
        throw AppError.conflict('supplier.invitation_pending', 'An invitation is already pending for that address.');
      }

      const invitation = await db.invitation.create({
        data: {
          organizationId,
          email,
          roleKeys: ['supplier_user'],
          supplierId,
          invitedByUserId: actorUserId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 14 * 24 * 3_600_000),
        },
      });

      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.user_invited',
        resourceType: 'invitation',
        resourceId: invitation.id,
        before: null,
        after: { supplierId, email },
        requestId,
      });

      const rawToken = randomBytes(32).toString('base64url');
      await prisma.magicLinkToken.create({
        data: {
          email,
          tokenHash: hashToken(rawToken),
          purpose: 'invite',
          invitationId: invitation.id,
          expiresAt: new Date(Date.now() + this.env.MAGIC_LINK_TTL_MINUTES * 60_000),
        },
      });
      await this.email.sendMagicLink(
        email,
        `${this.env.WEB_ORIGIN}/auth/verify?token=${rawToken}`,
        'invite',
      );

      return {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        createdAt: invitation.createdAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
      };
    });
  }

  async revoke(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    invitationId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      const invitation = await db.invitation.findFirst({
        where: { id: invitationId, organizationId, supplierId },
      });
      if (!invitation) throw AppError.notFound('invitation.not_found', 'Invitation not found.');
      if (invitation.status !== 'pending') {
        throw AppError.conflict('invitation.not_pending', 'Only a pending invitation can be revoked.');
      }
      await db.invitation.update({ where: { id: invitation.id }, data: { status: 'revoked' } });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.invitation_revoked',
        resourceType: 'invitation',
        resourceId: invitation.id,
        before: { status: 'pending' },
        after: { status: 'revoked' },
        requestId,
      });
    });
  }
}
