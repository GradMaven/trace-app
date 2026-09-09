import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { getPrisma } from '@trace/db';
import { MfaExempt } from '../../common/decorators';
import type { AuthenticatedActor } from '../../common/auth.guard';
import type { RequestWithContext } from '../../common/request-context';

@ApiTags('me')
@Controller('me')
export class MeController {
  @Get()
  @MfaExempt()
  @ApiOperation({
    summary: 'The current user, their memberships, and permissions for the active org.',
  })
  async me(@Req() req: Request): Promise<MeResponse> {
    const actor = (req as RequestWithContext & { actor?: AuthenticatedActor }).actor!;
    const prisma = getPrisma();

    const memberships = await prisma.membership.findMany({
      where: { userId: actor.userId, status: 'active' },
      include: {
        organization: { select: { id: true, slug: true, legalName: true } },
        supplier: { select: { id: true, name: true } },
        roles: { include: { role: { select: { key: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      user: { id: actor.userId, email: actor.email, name: actor.name },
      activeOrganizationId: actor.organizationId,
      activeSupplierId: actor.supplierId,
      permissions: actor.permissions,
      mfa: {
        required: actor.mfaRequired,
        satisfied: actor.mfaSatisfied,
        enrolled: actor.mfaEnrolled,
      },
      memberships: memberships.map((m) => ({
        organization: m.organization,
        supplier: m.supplier,
        roles: m.roles.map((r) => r.role),
      })),
    };
  }
}

interface MeResponse {
  user: { id: string; email: string; name: string };
  activeOrganizationId: string | null;
  activeSupplierId: string | null;
  permissions: string[];
  mfa: { required: boolean; satisfied: boolean; enrolled: boolean };
  memberships: Array<{
    organization: { id: string; slug: string; legalName: string };
    supplier: { id: string; name: string } | null;
    roles: Array<{ key: string; name: string }>;
  }>;
}
