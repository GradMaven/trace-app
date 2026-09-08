import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import {
  MembersService,
  type InvitationView,
  type MemberView,
} from './members.service';
import { inviteMemberSchema, type InviteMemberInput } from './members.dto';

@ApiTags('members')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('member.read')
  @ApiOperation({ summary: 'List members of the active organization.' })
  list(@CurrentActor() actor: AuthenticatedActor): Promise<MemberView[]> {
    return this.members.list(actor.organizationId!);
  }

  @Get('invitations')
  @RequirePermission('member.read')
  @ApiOperation({ summary: 'List invitations for the active organization.' })
  listInvitations(@CurrentActor() actor: AuthenticatedActor): Promise<InvitationView[]> {
    return this.members.listInvitations(actor.organizationId!);
  }

  @Post('invitations')
  @RequirePermission('member.invite')
  @HttpCode(201)
  @ApiOperation({ summary: 'Invite a user to the active organization with one or more roles.' })
  invite(
    @Body(new ZodPipe(inviteMemberSchema)) body: InviteMemberInput,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<InvitationView> {
    const requestId = getContext()?.requestId ?? 'unknown';
    return this.members.invite(actor.organizationId!, actor.userId, body, requestId);
  }

  @Post('invitations/:id/revoke')
  @RequirePermission('member.invite')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a pending invitation.' })
  async revoke(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await this.members.revokeInvitation(actor.organizationId!, actor.userId, id, requestId);
  }
}
