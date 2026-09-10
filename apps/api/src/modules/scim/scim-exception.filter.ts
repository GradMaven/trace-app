import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { isAppError } from '@trace/shared';
import { scimError, SCIM_CONTENT_TYPE } from '@trace/domain';
import { getContext } from '@trace/db';
import type { Response } from 'express';

/**
 * Renders errors on the SCIM routes as an RFC 7644 Error object with the
 * `application/scim+json` content type, instead of the app-wide `{ error: … }`
 * envelope. Bound per-controller with `@UseFilters`.
 */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('SCIM');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = getContext()?.requestId ?? 'unknown';

    let status = 500;
    let detail = 'Internal error.';
    let scimType: string | undefined;

    if (isAppError(exception)) {
      status = exception.httpStatus;
      detail = exception.message;
      if (exception.code === 'scim.uniqueness') scimType = 'uniqueness';
      else if (exception.errorClass === 'validation' || exception.errorClass === 'unprocessable') {
        scimType = 'invalidValue';
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      detail =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message?.toString() ?? exception.message);
    }

    if (status >= 500) {
      this.logger.error(
        `${detail} [request ${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      detail = 'Something went wrong.';
    } else {
      this.logger.warn(`${status} ${detail} [request ${requestId}]`);
    }

    res.status(status).type(SCIM_CONTENT_TYPE).json(scimError(status, detail, scimType));
  }
}
