import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { AppError, isAppError } from '@trace/shared';
import { getContext } from '@trace/db';
import type { Response } from 'express';

/**
 * Single error renderer. Produces:
 *   { "error": { code, message, requestId, details } }
 * `AppError` maps directly; Nest `HttpException` is adapted; anything else is a
 * 500 with a generic message (details are logged, never leaked).
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = getContext()?.requestId ?? 'unknown';

    const error = this.normalize(exception);

    if (error.httpStatus >= 500) {
      this.logger.error(
        `${error.code}: ${error.message} [request ${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${error.code}: ${error.message} [request ${requestId}]`);
    }

    res.status(error.httpStatus).json({
      error: {
        code: error.code,
        message: error.httpStatus >= 500 ? 'Something went wrong.' : error.message,
        requestId,
        details: error.details,
      },
    });
  }

  private normalize(exception: unknown): AppError {
    if (isAppError(exception)) return exception;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return new AppError({
        errorClass: mapStatus(status),
        code: `http.${status}`,
        message: Array.isArray(message) ? message.join('; ') : message,
      });
    }

    return AppError.internal('internal.error', 'Something went wrong.', exception);
  }
}

function mapStatus(status: number): AppError['errorClass'] {
  switch (status) {
    case 400:
      return 'validation';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal' : 'validation';
  }
}
