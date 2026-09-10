import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import type { RegulatoryFiling } from '@trace/domain';
import {
  generateRegulatoryFiling,
  getContext,
  listRegulatoryFilings,
  regulatoryFilingById,
  withOrgContext,
  type RegulatoryFilingRow,
} from '@trace/db';
import type { StorageService } from '@trace/storage';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { STORAGE_SERVICE } from '../storage/storage.module';

const DOWNLOAD_TTL_SECONDS = 300;

const generateSchema = z.object({
  regulationKey: z.string().trim().max(64).optional(),
  reportingPeriod: z.string().trim().max(32).optional(),
  ruleStoreVersion: z.string().trim().max(64).optional(),
});

@ApiTags('filings')
@Controller('filings')
export class FilingsController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @RequirePermission('compliance.read')
  @ApiOperation({ summary: 'Regulatory filings for this organization (summary rows).' })
  list(@CurrentActor() actor: AuthenticatedActor): Promise<RegulatoryFilingRow[]> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => listRegulatoryFilings(db, org));
  }

  @Post('generate')
  @RequirePermission('compliance.manage')
  @ApiOperation({
    summary: 'Assemble a regulatory disclosure document and store an immutable version.',
  })
  generate(
    @Body(new ZodPipe(generateSchema)) body: z.infer<typeof generateSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<RegulatoryFilingRow & { filing: RegulatoryFiling }> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      generateRegulatoryFiling(
        db,
        {
          driver: this.storage.driver,
          putBytes: (key, bytes, contentType) =>
            this.storage.put({ key, body: bytes, contentType }),
        },
        {
          organizationId: org,
          regulationKey: body.regulationKey,
          reportingPeriod: body.reportingPeriod,
          ruleStoreVersion: body.ruleStoreVersion,
          generatedByUserId: actor.userId,
          requestId: this.rid(),
        },
      ),
    );
  }

  @Get(':id')
  @RequirePermission('compliance.read')
  @ApiOperation({ summary: 'A filing summary plus the full assembled document from storage.' })
  async detail(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<RegulatoryFilingRow & { filing: RegulatoryFiling | null }> {
    const org = actor.organizationId!;
    const row = await withOrgContext(org, (db) => regulatoryFilingById(db, org, id));
    let filing: RegulatoryFiling | null = null;
    try {
      const bytes = await this.storage.get(row.storageKey);
      filing = JSON.parse(bytes.toString('utf8')) as RegulatoryFiling;
    } catch {
      filing = null;
    }
    return { ...row, filing };
  }

  @Get(':id/download')
  @RequirePermission('compliance.read')
  @ApiOperation({ summary: 'A short-lived signed URL to download the filing JSON or HTML.' })
  async download(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Query('format') format?: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const org = actor.organizationId!;
    const row = await withOrgContext(org, (db) => regulatoryFilingById(db, org, id));
    const html = format === 'html';
    const key = html ? row.htmlStorageKey : row.storageKey;
    if (!key) throw AppError.notFound('filing.no_artifact', 'This filing has no stored artifact.');
    const url = await this.storage.signedDownloadUrl(key, {
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      filename: `filing-${row.regulationKey}-${row.reportingPeriod}-v${row.version}.${
        html ? 'html' : 'json'
      }`,
    });
    return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
  }
}
