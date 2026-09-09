import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { loadEnv } from '@trace/config';
import type { Jwks } from '@trace/domain';
import {
  beginSsoLogin,
  completeSsoLogin,
  getContext,
  getPrisma,
  type CompleteSsoLoginDeps,
} from '@trace/db';
import { MfaExempt, Public } from '../../common/decorators';
import { AuthService } from '../auth/auth.service';

const API_PREFIX = 'api/v1';
const FETCH_TIMEOUT_MS = 8_000;

/** Real OIDC I/O — injected into `completeSsoLogin` so the CI test can stub it. */
const oidcDeps: CompleteSsoLoginDeps = {
  async exchangeCode(input) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code_verifier: input.codeVerifier,
    });
    const res = await fetch(input.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
    return (await res.json()) as { id_token?: string };
  },
  async fetchJwks(jwksUri) {
    const res = await fetch(jwksUri, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`JWKS endpoint returned ${res.status}`);
    return (await res.json()) as Jwks;
  },
};

@ApiTags('sso')
@Controller('auth/sso')
export class SsoAuthController {
  constructor(private readonly auth: AuthService) {}

  private redirectUri(slug: string): string {
    return `${loadEnv().API_PUBLIC_URL}/${API_PREFIX}/auth/sso/${slug}/callback`;
  }

  private loginError(res: Response, code: string): void {
    res.redirect(302, `${loadEnv().WEB_ORIGIN}/login?sso_error=${encodeURIComponent(code)}`);
  }

  @Get(':slug/start')
  @Public()
  @MfaExempt()
  @ApiOperation({
    summary: 'Begin an OIDC login for a workspace — redirects to the identity provider.',
  })
  async start(
    @Param('slug') slug: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const { authorizationUrl } = await beginSsoLogin(getPrisma(), {
        orgSlug: slug,
        redirectUri: this.redirectUri(slug),
        redirectAfter: redirect,
      });
      res.redirect(302, authorizationUrl);
    } catch (err) {
      this.loginError(res, (err as { code?: string })?.code ?? 'sso.start_failed');
    }
  }

  @Get(':slug/callback')
  @Public()
  @MfaExempt()
  @ApiOperation({
    summary: 'OIDC redirect target — verifies the ID token, provisions, and signs in.',
  })
  async callback(
    @Param('slug') slug: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') idpError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (idpError) return this.loginError(res, `idp:${idpError}`);
    if (!code || !state) return this.loginError(res, 'sso.missing_params');

    const requestId = getContext()?.requestId ?? 'unknown';
    try {
      const result = await completeSsoLogin(getPrisma(), oidcDeps, {
        state,
        code,
        redirectUri: this.redirectUri(slug),
        requestId,
      });
      await this.auth.createSession(result.userId, res, requestId);
      const target =
        result.redirectAfter && result.redirectAfter.startsWith('/') ? result.redirectAfter : '/';
      res.redirect(302, `${loadEnv().WEB_ORIGIN}${target}`);
    } catch (err) {
      void req;
      this.loginError(res, (err as { code?: string })?.code ?? 'sso.callback_failed');
    }
  }
}
