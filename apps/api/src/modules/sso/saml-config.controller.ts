import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { loadEnv } from '@trace/config';
import {
  deleteSamlProvider,
  getContext,
  getPrisma,
  getSamlProvider,
  upsertSamlProvider,
  withOrgContext,
  type SamlProviderView,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const API_PREFIX = 'api/v1';

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
  idpEntityId: z.string().trim().min(1).max(1024),
  ssoUrl: z.string().url(),
  certificates: z.array(z.string().min(1).max(20_000)).min(1).max(5),
  emailAttribute: z.string().max(256).optional().nullable(),
  nameAttribute: z.string().max(256).optional().nullable(),
  groupsAttribute: z.string().max(256).optional().nullable(),
  wantAssertionsSigned: z.boolean().optional(),
  roleMapping: roleMapSchema,
  allowedEmailDomains: z.array(z.string().max(253)).max(50).optional(),
});

@ApiTags('sso')
@Controller('settings/saml')
@RequirePermission('security.manage')
export class SamlConfigController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @ApiOperation({ summary: 'The SAML provider config + the SP URLs to register at the IdP.' })
  async get(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{
    provider: SamlProviderView | null;
    orgSlug: string;
    acsUrl: string;
    startUrl: string;
    spEntityId: string;
    metadataUrl: string;
  }> {
    const env = loadEnv();
    const prisma = getPrisma();
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId! },
      select: { slug: true },
    });
    const provider = await withOrgContext(actor.organizationId!, (db) =>
      getSamlProvider(db, actor.organizationId!),
    );
    const base = `${env.API_PUBLIC_URL}/${API_PREFIX}/auth/saml/${org.slug}`;
    return {
      provider,
      orgSlug: org.slug,
      acsUrl: `${base}/acs`,
      startUrl: `${base}/start`,
      spEntityId: `${base}/metadata`,
      metadataUrl: `${base}/metadata`,
    };
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Create or update the SAML identity provider for this organization.' })
  async put(
    @Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      upsertSamlProvider(db, {
        organizationId: actor.organizationId!,
        config: body,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the SAML provider (existing links are kept).' })
  async remove(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      deleteSamlProvider(db, {
        organizationId: actor.organizationId!,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
