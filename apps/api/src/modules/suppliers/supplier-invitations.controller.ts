import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { getContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import {
  SupplierInvitationsService,
  type SupplierInvitationView,
} from './supplier-invitations.service';

const inviteSchema = z.object({
  email: z.string().email().max(320).transform((v) => v.trim().toLowerCase()),
});

@ApiTags('suppliers')
@Controller('suppliers/:id/invitations')
export class SupplierInvitationsController {
  constructor(private readonly invitations: SupplierInvitationsService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @RequirePermission('supplier.invite')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') supplierId: string,
  ): Promise<SupplierInvitationView[]> {
    return this.invitations.list(actor.organizationId!, supplierId);
  }

  @Post()
  @RequirePermission('supplier.invite')
  @HttpCode(201)
  @ApiOperation({ summary: 'Invite a supplier-portal user for this supplier.' })
  invite(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') supplierId: string,
    @Body(new ZodPipe(inviteSchema)) body: { email: string },
  ): Promise<SupplierInvitationView> {
    return this.invitations.invite(
      actor.organizationId!,
      supplierId,
      actor.userId,
      body.email,
      this.rid(),
    );
  }

  @Post(':invitationId/revoke')
  @RequirePermission('supplier.invite')
  @HttpCode(204)
  async revoke(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') supplierId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    await this.invitations.revoke(
      actor.organizationId!,
      supplierId,
      actor.userId,
      invitationId,
      this.rid(),
    );
  }
}
