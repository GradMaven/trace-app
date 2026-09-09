import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import {
  exportJobById,
  expireStaleExports,
  getContext,
  listExportJobs,
  runExport,
  withOrgContext,
  type ExportJobView,
  type RunExportResult,
} from '@trace/db';
import type { StorageService } from '@trace/storage';
import { CurrentActor, Metered, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { STORAGE_SERVICE } from '../storage/storage.module';

const DOWNLOAD_TTL_SECONDS = 300;
const createSchema = z.object({ reportingPeriod: z.string().max(60).optional() });

@ApiTags('exports')
@Controller('exports')
@RequirePermission('data.export')
export class ExportsController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @ApiOperation({ summary: 'List data-export jobs for the active organization.' })
  list(@CurrentActor() actor: AuthenticatedActor): Promise<ExportJobView[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      await expireStaleExports(db, actor.organizationId!);
      return listExportJobs(db, actor.organizationId!);
    });
  }

  @Post()
  @Metered('export_job')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Assemble a full copy of the organization’s records as a canonical-JSON bundle in object storage.',
  })
  create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<RunExportResult> {
    return withOrgContext(actor.organizationId!, (db) =>
      runExport(
        db,
        {
          driver: this.storage.driver,
          putBytes: (key, bytes, contentType) =>
            this.storage.put({ key, body: bytes, contentType }),
        },
        {
          organizationId: actor.organizationId!,
          reportingPeriod: body.reportingPeriod ?? null,
          actorUserId: actor.userId,
          requestId: this.rid(),
        },
      ),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'One export job with its section counts and manifest.' })
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<ExportJobView> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const { storageKey: _drop, ...view } = await exportJobById(db, actor.organizationId!, id);
      void _drop;
      return view;
    });
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'A short-lived signed URL to download the export bundle.' })
  download(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const job = await exportJobById(db, actor.organizationId!, id);
      if (job.status !== 'ready' || !job.storageKey) {
        throw AppError.notFound('export.not_ready', 'This export is not available for download.');
      }
      const url = await this.storage.signedDownloadUrl(job.storageKey, {
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        filename: `trace-export-${job.reportingPeriod ?? 'all'}-${(job.sha256 ?? '').slice(0, 12)}.json`,
      });
      return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
    });
  }
}
