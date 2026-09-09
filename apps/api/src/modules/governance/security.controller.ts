import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { getContext, withOrgContext, writeAuditLog } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const updateSchema = z
  .object({
    requireMfa: z.boolean().optional(),
    legalHold: z.boolean().optional(),
  })
  .refine((v) => v.requireMfa !== undefined || v.legalHold !== undefined, {
    message: 'Provide requireMfa and/or legalHold.',
  });

@ApiTags('settings')
@Controller('settings/security')
@RequirePermission('security.manage')
export class SecurityController {
  @Get()
  @ApiOperation({ summary: 'Organization security settings + MFA adoption.' })
  get(@CurrentActor() actor: AuthenticatedActor): Promise<unknown> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const org = await db.organization.findUniqueOrThrow({
        where: { id: actor.organizationId! },
        select: { requireMfa: true, legalHold: true },
      });
      const members = await db.membership.findMany({
        where: { organizationId: actor.organizationId!, status: 'active', supplierId: null },
        select: { userId: true },
      });
      const withMfa = members.length
        ? await db.user.count({
            where: { id: { in: members.map((m) => m.userId) }, mfaEnabled: true },
          })
        : 0;
      return {
        requireMfa: org.requireMfa,
        legalHold: org.legalHold,
        members: members.length,
        membersWithMfa: withMfa,
      };
    });
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Update MFA enforcement and/or legal hold for the organization.' })
  async update(
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await withOrgContext(actor.organizationId!, async (db) => {
      const before = await db.organization.findUniqueOrThrow({
        where: { id: actor.organizationId! },
        select: { requireMfa: true, legalHold: true },
      });
      await db.organization.update({
        where: { id: actor.organizationId! },
        data: {
          requireMfa: body.requireMfa ?? undefined,
          legalHold: body.legalHold ?? undefined,
        },
      });
      await writeAuditLog(db, {
        organizationId: actor.organizationId!,
        actorId: actor.userId,
        action: 'security.settings_updated',
        resourceType: 'organization',
        resourceId: actor.organizationId!,
        before,
        after: {
          requireMfa: body.requireMfa ?? before.requireMfa,
          legalHold: body.legalHold ?? before.legalHold,
        },
        requestId,
      });
    });
  }
}
