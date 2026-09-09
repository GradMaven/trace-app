import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError, paginationQuerySchema } from '@trace/shared';
import { generateAuditPackage, getContext, withOrgContext } from '@trace/db';
import type { StorageService } from '@trace/storage';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { STORAGE_SERVICE } from '../storage/storage.module';

const DEFAULT_VERSION = 'esrs@2026.1';
const DOWNLOAD_TTL_SECONDS = 300;

const generateSchema = z.object({
  auditId: z.string().uuid().optional(),
  reportingPeriod: z.string().max(60).optional(),
  version: z.string().max(60).default(DEFAULT_VERSION),
});

@ApiTags('audit')
@Controller('audit/packages')
export class AuditPackagesController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @RequirePermission('audit.read')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(paginationQuerySchema)) query: z.infer<typeof paginationQuerySchema>,
  ): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const rows = await db.auditPackage.findMany({
        where: { organizationId: actor.organizationId! },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      });
      return rows.map((p) => ({
        id: p.id,
        status: p.status,
        reportingPeriod: p.reportingPeriod,
        ruleStoreVersion: p.ruleStoreVersion,
        format: p.format,
        sizeBytes: p.sizeBytes,
        contentDigest: p.contentDigest,
        readinessValue: p.readinessValue,
        manifest: p.manifest,
        generatedAt: p.generatedAt ? p.generatedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        error: p.error,
      }));
    });
  }

  @Post()
  @RequirePermission('audit.manage')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Assemble an exportable audit package (evidence, calculations, lineage, compliance, findings, trail).',
  })
  generate(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(generateSchema)) body: z.infer<typeof generateSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      generateAuditPackage(
        db,
        {
          driver: this.storage.driver,
          putBytes: (key, bytes, contentType) =>
            this.storage.put({ key, body: bytes, contentType }),
        },
        {
          organizationId: actor.organizationId!,
          auditId: body.auditId,
          reportingPeriod: body.reportingPeriod,
          ruleStoreVersion: body.version,
          actorUserId: actor.userId,
          requestId: this.rid(),
        },
      ),
    );
  }

  @Get(':id')
  @RequirePermission('audit.read')
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const p = await db.auditPackage.findFirst({
        where: { id, organizationId: actor.organizationId! },
      });
      if (!p) throw AppError.notFound('audit.package_not_found', 'Audit package not found.');
      return {
        id: p.id,
        status: p.status,
        reportingPeriod: p.reportingPeriod,
        ruleStoreVersion: p.ruleStoreVersion,
        format: p.format,
        sizeBytes: p.sizeBytes,
        checksumSha256: p.checksumSha256,
        contentDigest: p.contentDigest,
        manifest: p.manifest,
        readinessValue: p.readinessValue,
        generatedAt: p.generatedAt ? p.generatedAt.toISOString() : null,
        error: p.error,
      };
    });
  }

  @Get(':id/download')
  @RequirePermission('audit.read')
  @ApiOperation({ summary: 'A short-lived signed URL to download the audit package JSON.' })
  download(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const p = await db.auditPackage.findFirst({
        where: { id, organizationId: actor.organizationId! },
      });
      if (!p || !p.storageKey || p.status !== 'ready') {
        throw AppError.notFound(
          'audit.package_not_ready',
          'Audit package is not ready for download.',
        );
      }
      const url = await this.storage.signedDownloadUrl(p.storageKey, {
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        filename: `audit-package-${p.reportingPeriod ?? 'all'}-${p.contentDigest.slice(0, 12)}.json`,
      });
      return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
    });
  }
}
