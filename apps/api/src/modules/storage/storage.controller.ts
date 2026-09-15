import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppError } from '@trace/shared';
import type { StorageService } from '@trace/storage';
import { Public } from '../../common/decorators';
import { STORAGE_SERVICE } from './storage.tokens';

/**
 * Serves local-driver document content for a valid signed token. Unused when
 * STORAGE_DRIVER=s3 (those signed URLs point straight at the bucket).
 */
@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  @Get('local')
  @Public()
  @ApiOperation({ summary: 'Download local-driver document content (signed token).' })
  async local(@Query('token') token: string | undefined, @Res() res: Response): Promise<void> {
    if (this.storage.driver !== 'local') {
      throw AppError.notFound('storage.not_found', 'Not found.');
    }
    const verified = token ? this.storage.verifyLocalToken(token) : null;
    if (!verified) {
      throw AppError.forbidden('storage.invalid_token', 'Invalid or expired download link.');
    }
    const head = await this.storage.head(verified.key);
    const body = await this.storage.get(verified.key);
    res.setHeader('content-type', head?.contentType ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=0, no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(body);
  }
}
