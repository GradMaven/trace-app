import { Controller, Delete, Get, HttpCode, Post, Put, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { loadEnv } from '@trace/config';
import {
  deleteScimConfig,
  getContext,
  getPrisma,
  getScimConfig,
  rotateScimToken,
  scimAdminOverview,
  upsertScimConfig,
  withOrgContext,
  type ScimAdminOverview,
  type ScimConfigView,
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
const configSchema = z.object({
  enabled: z.boolean(),
  defaultRoles: roleList.min(1),
  groupRoleMapping: z.record(z.string().max(128), roleList).default({}),
});

@ApiTags('scim')
@Controller('settings/scim')
@RequirePermission('security.manage')
export class ScimConfigController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @ApiOperation({ summary: 'SCIM connection config (no token), the base URL, and provisioned users / groups.' })
  async get(@CurrentActor() actor: AuthenticatedActor): Promise<{
    config: ScimConfigView | null;
    baseUrl: string;
    overview: ScimAdminOverview;
  }> {
    const org = actor.organizationId!;
    const o = await getPrisma().organization.findUniqueOrThrow({
      where: { id: org },
      select: { slug: true },
    });
    const { config, overview } = await withOrgContext(org, async (db) => ({
      config: await getScimConfig(db, org),
      overview: await scimAdminOverview(db, org),
    }));
    return {
      config,
      overview,
      baseUrl: `${loadEnv().API_PUBLIC_URL}/api/v1/scim/v2/${o.slug}`,
    };
  }

  @Put()
  @HttpCode(204)
  @ApiOperation({ summary: 'Create or update the SCIM connection for this organization.' })
  async put(
    @Body(new ZodPipe(configSchema)) body: z.infer<typeof configSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      upsertScimConfig(db, {
        organizationId: actor.organizationId!,
        config: body,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Post('token')
  @ApiOperation({ summary: 'Issue a new SCIM bearer token (shown once). Invalidates the previous one.' })
  async rotate(@CurrentActor() actor: AuthenticatedActor): Promise<{ token: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      rotateScimToken(db, {
        organizationId: actor.organizationId!,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the SCIM connection (provisioned members are kept, memberships suspended-as-is).' })
  async remove(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await withOrgContext(actor.organizationId!, (db) =>
      deleteScimConfig(db, {
        organizationId: actor.organizationId!,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
