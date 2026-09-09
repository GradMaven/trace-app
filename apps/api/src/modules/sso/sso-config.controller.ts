import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import { loadEnv } from '@trace/config';
import {
  deleteIdentityProvider,
  getContext,
  getIdentityProvider,
  getPrisma,
  upsertIdentityProvider,
  withOrgContext,
  type IdentityProviderView,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const roleList = z
  .array(
    z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{2,39}$/),
  )
  .max(20);
const roleMapSchema = z.object({
  defaultRoles: roleList.min(1),
  emailDomainRoles: z.record(z.string(), roleList).optional(),
  groupClaim: z.string().max(64).optional(),
  groupRoles: z.record(z.string(), roleList).optional(),
});
const configSchema = z.object({
  enabled: z.boolean(),
  issuer: z.string().url(),
  clientId: z.string().trim().min(1).max(256),
  // Optional on update — omit to keep the stored secret.
  clientSecret: z.string().min(1).max(512).optional(),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  jwksUri: z.string().url(),
  scopes: z.string().max(200).optional(),
  roleMapping: roleMapSchema,
  allowedEmailDomains: z.array(z.string().max(253)).max(50).optional(),
});
const discoverSchema = z.object({ issuer: z.string().url() });

@ApiTags('sso')
@Controller('settings/sso')
@RequirePermission('security.manage')
export class SsoConfigController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @ApiOperation({
    summary: 'The OIDC provider config (no client secret) + the redirect URI to register.',
  })
  async get(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{
    provider: IdentityProviderView | null;
    orgSlug: string;
    redirectUri: string;
    startUrl: string;
  }> {
    const env = loadEnv();
    const prisma = getPrisma();
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId! },
      select: { slug: true },
    });
    const provider = await withOrgContext(actor.organizationId!, (db) =>
      getIdentityProvider(db, actor.organizationId!),
    );
    return {
      provider,
      orgSlug: org.slug,
      redirectUri: `${env.API_PUBLIC_URL}/api/v1/auth/sso/${org.slug}/callback`,
      startUrl: `${env.API_PUBLIC_URL}/api/v1/auth/sso/${org.slug}/start`,
    };
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Create or update the OIDC identity provider for this organization.' })
  async put(
    @Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      upsertIdentityProvider(db, {
        organizationId: actor.organizationId!,
        config: body,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the identity provider (existing SSO links are kept).' })
  async remove(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      deleteIdentityProvider(db, {
        organizationId: actor.organizationId!,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Post('discover')
  @ApiOperation({ summary: 'Fetch the IdP discovery document and return its endpoints.' })
  async discover(
    @Body(new ZodPipe(discoverSchema)) body: z.infer<typeof discoverSchema>,
  ): Promise<{
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    jwksUri: string;
  }> {
    const url = `${body.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    let doc: Record<string, unknown>;
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      doc = (await res.json()) as Record<string, unknown>;
    } catch {
      throw AppError.unprocessable('sso.discovery_failed', `Could not read ${url}.`);
    }
    const need = (k: string): string => {
      const v = doc[k];
      if (typeof v !== 'string')
        throw AppError.unprocessable(
          'sso.discovery_incomplete',
          `Discovery document is missing "${k}".`,
        );
      return v;
    };
    return {
      issuer: typeof doc.issuer === 'string' ? doc.issuer : body.issuer,
      authorizationEndpoint: need('authorization_endpoint'),
      tokenEndpoint: need('token_endpoint'),
      jwksUri: need('jwks_uri'),
    };
  }
}
