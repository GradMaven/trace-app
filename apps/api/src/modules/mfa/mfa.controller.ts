import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import {
  beginMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  getContext,
  getMfaStatus,
  getPrisma,
  resolveMfaRequirement,
  type MfaStatus,
} from '@trace/db';
import { CurrentActor, MfaExempt } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const codeSchema = z.object({ code: z.string().trim().min(4).max(40) });

@ApiTags('mfa')
@Controller('me/mfa')
export class MfaController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @MfaExempt()
  @ApiOperation({ summary: 'Current two-factor status for the signed-in user.' })
  async status(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<MfaStatus & { orgMandates: boolean }> {
    const prisma = getPrisma();
    const [s, req] = await Promise.all([
      getMfaStatus(prisma, actor.userId),
      resolveMfaRequirement(prisma, actor.userId, actor.organizationId),
    ]);
    return { ...s, orgMandates: req.orgMandates };
  }

  @Post('setup')
  @MfaExempt()
  @ApiOperation({
    summary: 'Begin TOTP enrolment — returns a secret + otpauth URI. Not yet active.',
  })
  setup(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    return beginMfaEnrollment(getPrisma(), actor.userId, actor.email);
  }

  @Post('confirm')
  @MfaExempt()
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm enrolment with a live code. Returns one-time recovery codes.' })
  async confirm(
    @Body(new ZodPipe(codeSchema)) body: { code: string },
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ recoveryCodes: string[] }> {
    const result = await confirmMfaEnrollment(getPrisma(), {
      userId: actor.userId,
      code: body.code,
      organizationId: actor.organizationId ?? undefined,
      requestId: this.rid(),
    });
    // Enrolling proves possession — mark this session MFA-satisfied.
    if (!actor.sessionId.startsWith('apikey:')) {
      await getPrisma().session.update({
        where: { id: actor.sessionId },
        data: { mfaPassed: true },
      });
    }
    return result;
  }

  @Post('disable')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Turn off two-factor auth (requires a current code). Blocked if the org mandates MFA.',
  })
  async disable(
    @Body(new ZodPipe(codeSchema)) body: { code: string },
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const req = await resolveMfaRequirement(getPrisma(), actor.userId, actor.organizationId);
    if (req.orgMandates) {
      throw AppError.forbidden(
        'mfa.org_mandated',
        'Your organization requires two-factor auth; it cannot be disabled.',
      );
    }
    await disableMfa(getPrisma(), {
      userId: actor.userId,
      code: body.code,
      organizationId: actor.organizationId ?? undefined,
      requestId: this.rid(),
    });
  }
}
