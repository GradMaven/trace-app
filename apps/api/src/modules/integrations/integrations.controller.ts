import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import { listIntegrationAdapters, type ColumnMapping, type ImportDefaults } from '@trace/domain';
import {
  commitImport,
  createIntegration,
  getContext,
  integrationRunById,
  listIntegrationRuns,
  listIntegrations,
  previewImport,
  updateIntegration,
  withOrgContext,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const FILE_LIMIT = 5 * 1024 * 1024;

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const mappingCell = z.object({
  column: z.string().max(200).optional(),
  constant: z.string().max(500).optional(),
});
const importFormSchema = z.object({
  kind: z.string().min(1).max(60),
  integrationId: z.string().uuid().optional(),
  mapping: z
    .string()
    .max(20_000)
    .transform((s, ctx) => {
      try {
        return z.record(z.string(), mappingCell).parse(JSON.parse(s)) as ColumnMapping;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mapping must be a JSON object' });
        return z.NEVER;
      }
    }),
  defaults: z
    .string()
    .max(4_000)
    .optional()
    .transform((s, ctx) => {
      if (!s) return {} as ImportDefaults;
      try {
        return z
          .object({
            reportingPeriod: z.string().max(60).optional(),
            subjectType: z.string().max(40).optional(),
            subjectId: z.string().max(80).optional(),
            provenance: z.string().max(40).optional(),
          })
          .parse(JSON.parse(s)) as ImportDefaults;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'defaults must be a JSON object' });
        return z.NEVER;
      }
    }),
});

const createIntegrationSchema = z.object({
  kind: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()).optional(),
});
const patchIntegrationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
});

function decodeText(file: MulterFile | undefined): string {
  if (!file)
    throw AppError.unprocessable(
      'integration.no_file',
      'Attach a CSV/TSV file in the "file" field.',
    );
  if (file.size > FILE_LIMIT) {
    throw AppError.unprocessable(
      'integration.file_too_large',
      'The file exceeds the 5 MB import limit.',
    );
  }
  const head = file.buffer.subarray(0, 8192);
  if (head.includes(0)) {
    throw AppError.unprocessable(
      'integration.not_text',
      'The file does not look like plain text (CSV/TSV).',
    );
  }
  return file.buffer.toString('utf8');
}

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('adapters')
  @RequirePermission('activity.read')
  @ApiOperation({ summary: 'Available integration adapters and the TRACE fields they map into.' })
  adapters(): unknown {
    return listIntegrationAdapters();
  }

  @Get()
  @RequirePermission('activity.read')
  list(@CurrentActor() actor: AuthenticatedActor): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      listIntegrations(db, actor.organizationId!),
    );
  }

  @Post()
  @RequirePermission('integration.manage')
  @HttpCode(201)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createIntegrationSchema)) body: z.infer<typeof createIntegrationSchema>,
  ): Promise<{ id: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      createIntegration(db, {
        organizationId: actor.organizationId!,
        kind: body.kind,
        name: body.name,
        config: body.config,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Patch(':id')
  @RequirePermission('integration.manage')
  patch(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(patchIntegrationSchema)) body: z.infer<typeof patchIntegrationSchema>,
  ): Promise<{ id: string }> {
    return withOrgContext(actor.organizationId!, (db) =>
      updateIntegration(db, {
        organizationId: actor.organizationId!,
        integrationId: id,
        name: body.name,
        config: body.config,
        status: body.status,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Post('imports/preview')
  @RequirePermission('integration.manage')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Dry-run: parse, map and validate an uploaded CSV/TSV. Writes nothing.',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FILE_LIMIT + 1024 } }))
  preview(
    @UploadedFile() file: MulterFile | undefined,
    @Body(new ZodPipe(importFormSchema)) body: z.infer<typeof importFormSchema>,
  ): unknown {
    return previewImport(body.kind, decodeText(file), body.mapping, body.defaults);
  }

  @Post('imports/commit')
  @RequirePermission('integration.manage')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import the valid rows as activity data. Re-validates the file first.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FILE_LIMIT + 1024 } }))
  commit(
    @CurrentActor() actor: AuthenticatedActor,
    @UploadedFile() file: MulterFile | undefined,
    @Body(new ZodPipe(importFormSchema)) body: z.infer<typeof importFormSchema>,
  ): Promise<unknown> {
    const text = decodeText(file);
    const checksum = createHash('sha256').update(file!.buffer).digest('hex');
    return withOrgContext(actor.organizationId!, (db) =>
      commitImport(db, {
        organizationId: actor.organizationId!,
        kind: body.kind,
        integrationId: body.integrationId,
        fileName: file!.originalname,
        fileChecksum: checksum,
        text,
        mapping: body.mapping,
        defaults: body.defaults,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('runs')
  @RequirePermission('activity.read')
  runs(@CurrentActor() actor: AuthenticatedActor): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      listIntegrationRuns(db, actor.organizationId!),
    );
  }

  @Get('runs/:id')
  @RequirePermission('activity.read')
  runDetail(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      integrationRunById(db, actor.organizationId!, id),
    );
  }
}
