import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { getContext } from '@trace/db';
import { Public, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { RequestWithContext } from '../../common/request-context';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { AuthService } from './auth.service';
import {
  requestMagicLinkSchema,
  switchOrganizationSchema,
  verifyMagicLinkSchema,
  type RequestMagicLinkInput,
  type SwitchOrganizationInput,
  type VerifyMagicLinkInput,
} from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('magic-link')
  @Public()
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a passwordless sign-in link (no account enumeration).' })
  async requestMagicLink(
    @Body(new ZodPipe(requestMagicLinkSchema)) body: RequestMagicLinkInput,
  ): Promise<{ status: 'accepted' }> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await this.auth.requestMagicLink(body.email, requestId);
    return { status: 'accepted' };
  }

  @Post('verify')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a magic-link token for a session cookie.' })
  async verify(
    @Body(new ZodPipe(verifyMagicLinkSchema)) body: VerifyMagicLinkInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VerifyResponse> {
    const requestId = getContext()?.requestId ?? 'unknown';
    const result = await this.auth.verifyMagicLink(body.token, res, requestId);
    return {
      user: { id: result.userId, email: result.email, name: result.name },
      acceptedInvitations: result.acceptedInvitations,
    };
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session and clear cookies.' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const actor = (req as RequestWithContext & { actor?: AuthenticatedActor }).actor;
    await this.auth.logout(actor?.sessionId ?? null, res);
  }

  @Post('switch-organization')
  @RequirePermission('organization.read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Set the active organization for the current session.' })
  async switchOrganization(
    @Body(new ZodPipe(switchOrganizationSchema)) body: SwitchOrganizationInput,
    @Req() req: Request,
  ): Promise<void> {
    const actor = (req as RequestWithContext & { actor?: AuthenticatedActor }).actor!;
    await this.auth.switchOrganization(actor.userId, actor.sessionId, body.organizationId);
  }
}

interface VerifyResponse {
  user: { id: string; email: string; name: string };
  acceptedInvitations: string[];
}
