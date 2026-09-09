import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { API_KEY_SCOPES } from '@trace/domain';
import {
  createApiKey,
  getContext,
  listApiKeys,
  revokeApiKey,
  withOrgContext,
  type ApiKeyView,
  type CreateApiKeyResult,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.string()).min(1).max(20),
  expiresAt: z.string().datetime().optional(),
});
type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;

@ApiTags('api-keys')
@Controller('api-keys')
@RequirePermission('apikey.manage')
export class ApiKeysController {
  @Get('scopes')
  @ApiOperation({ summary: 'The API-key scope catalog (token + description).' })
  scopes(): Array<{ scope: string; description: string }> {
    return Object.entries(API_KEY_SCOPES).map(([scope, description]) => ({ scope, description }));
  }

  @Get()
  @ApiOperation({ summary: 'List API keys for the active organization (never returns secrets).' })
  list(@CurrentActor() actor: AuthenticatedActor): Promise<ApiKeyView[]> {
    return withOrgContext(actor.organizationId!, (db) => listApiKeys(db, actor.organizationId!));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an API key. The full token is returned once, here, and never again.',
  })
  create(
    @Body(new ZodPipe(createApiKeySchema)) body: CreateApiKeyBody,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<CreateApiKeyResult> {
    const requestId = getContext()?.requestId ?? 'unknown';
    return withOrgContext(actor.organizationId!, (db) =>
      createApiKey(db, {
        organizationId: actor.organizationId!,
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }

  @Post(':id/revoke')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an API key immediately.' })
  async revoke(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await withOrgContext(actor.organizationId!, (db) =>
      revokeApiKey(db, {
        organizationId: actor.organizationId!,
        apiKeyId: id,
        actorUserId: actor.userId,
        requestId,
      }),
    );
  }
}
