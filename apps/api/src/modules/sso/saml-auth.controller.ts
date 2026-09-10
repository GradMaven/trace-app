import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { loadEnv } from '@trace/config';
import { buildSpMetadataXml } from '@trace/domain';
import { beginSamlLogin, completeSamlLogin, getContext, getPrisma } from '@trace/db';
import { MfaExempt, Public } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from '../auth/auth.service';

const API_PREFIX = 'api/v1';

const acsBodySchema = z.object({
  SAMLResponse: z.string().min(1).max(1_000_000),
  RelayState: z.string().min(1).max(512),
});

/**
 * SAML 2.0 Web-Browser-SSO. `GET /auth/saml/:slug/start` builds the AuthnRequest
 * and redirects to the IdP (HTTP-Redirect binding); the IdP posts the assertion
 * back to `POST /auth/saml/:slug/acs` (HTTP-POST binding). Both are `@Public()`
 * (no session yet) + `@MfaExempt()`; the ACS is CSRF-exempt because `@Public()`
 * routes are — the IdP form-post carries no cookie. `GET /auth/saml/:slug/metadata`
 * serves SP metadata for the admin to hand to the IdP.
 */
@ApiTags('sso')
@Controller('auth/saml')
export class SamlAuthController {
  constructor(private readonly auth: AuthService) {}

  private base(slug: string): string {
    return `${loadEnv().API_PUBLIC_URL}/${API_PREFIX}/auth/saml/${slug}`;
  }
  private acsUrl(slug: string): string {
    return `${this.base(slug)}/acs`;
  }
  private spEntityId(slug: string): string {
    return `${this.base(slug)}/metadata`;
  }
  private loginError(res: Response, code: string): void {
    res.redirect(302, `${loadEnv().WEB_ORIGIN}/login?sso_error=${encodeURIComponent(code)}`);
  }

  @Get(':slug/start')
  @Public()
  @MfaExempt()
  @ApiOperation({ summary: 'Begin a SAML login — redirects to the identity provider.' })
  async start(
    @Param('slug') slug: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { redirectUrl } = await beginSamlLogin(getPrisma(), {
        orgSlug: slug,
        acsUrl: this.acsUrl(slug),
        spEntityId: this.spEntityId(slug),
        redirectAfter: redirect,
      });
      res.redirect(302, redirectUrl);
    } catch (err) {
      this.loginError(res, (err as { code?: string })?.code ?? 'saml.start_failed');
    }
  }

  @Post(':slug/acs')
  @Public()
  @MfaExempt()
  @ApiOperation({
    summary: 'SAML Assertion Consumer Service — verifies the assertion, provisions, signs in.',
  })
  async acs(
    @Param('slug') slug: string,
    @Body(new ZodPipe(acsBodySchema)) body: z.infer<typeof acsBodySchema>,
    @Res() res: Response,
  ): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    try {
      const result = await completeSamlLogin(getPrisma(), {
        samlResponse: body.SAMLResponse,
        relayState: body.RelayState,
        acsUrl: this.acsUrl(slug),
        spEntityId: this.spEntityId(slug),
        requestId,
      });
      await this.auth.createSession(result.userId, res, requestId);
      const target =
        result.redirectAfter && result.redirectAfter.startsWith('/') ? result.redirectAfter : '/';
      res.redirect(302, `${loadEnv().WEB_ORIGIN}${target}`);
    } catch (err) {
      this.loginError(res, (err as { code?: string })?.code ?? 'saml.acs_failed');
    }
  }

  @Get(':slug/metadata')
  @Public()
  @MfaExempt()
  @ApiOperation({ summary: 'SP metadata XML for this workspace (register at the IdP).' })
  metadata(@Param('slug') slug: string, @Req() _req: Request, @Res() res: Response): void {
    const xml = buildSpMetadataXml({
      spEntityId: this.spEntityId(slug),
      acsUrl: this.acsUrl(slug),
      wantAssertionsSigned: true,
    });
    res.setHeader('content-type', 'application/xml; charset=utf-8');
    res.send(xml);
  }
}
