import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { paginationQuerySchema, type Page } from '@trace/shared';
import { getContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { DocumentsService, type DocumentView, type UploadedFile as UF } from './documents.service';

const UPLOAD_HARD_LIMIT = 32 * 1024 * 1024;

/** Minimal shape of a multer memory-storage file; avoids depending on @types/multer. */
interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Post()
  @RequirePermission('evidence.create')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document (multipart field "file"). Validated, scanned, stored.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT } }))
  upload(
    @CurrentActor() actor: AuthenticatedActor,
    @UploadedFile() file: MulterFile | undefined,
  ): Promise<DocumentView> {
    const uf: UF | undefined = file
      ? {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        }
      : undefined;
    return this.documents.upload(actor.organizationId!, actor.userId, uf, this.rid());
  }

  @Get()
  @RequirePermission('evidence.read')
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(paginationQuerySchema)) query: { limit: number; cursor?: string },
  ): Promise<Page<DocumentView>> {
    return this.documents.list(actor.organizationId!, query);
  }

  @Get(':id')
  @RequirePermission('evidence.read')
  @ApiOperation({ summary: 'Document metadata plus a short-lived signed download URL.' })
  get(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<DocumentView & { downloadUrl: string }> {
    return this.documents.get(actor.organizationId!, id);
  }

  @Get(':id/download-url')
  @RequirePermission('evidence.read')
  downloadUrl(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.documents.downloadUrl(actor.organizationId!, id);
  }

  @Delete(':id')
  @RequirePermission('evidence.update')
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<void> {
    await this.documents.remove(actor.organizationId!, id, actor.userId, this.rid());
  }

  @Post(':id/process')
  @RequirePermission('document.process')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run the AI extraction pipeline (parse → classify → extract candidates).' })
  process(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.documents.process(actor.organizationId!, id, actor.userId, this.rid());
  }

  @Get(':id/extraction')
  @RequirePermission('candidate.read')
  @ApiOperation({ summary: 'Extraction state, classification, and candidate datapoints for a document.' })
  extraction(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.documents.extraction(actor.organizationId!, id);
  }
}
