/**
 * Error taxonomy.
 *
 * Every expected failure is an `AppError` with a stable, namespaced `code` and an
 * HTTP status. The API exception filter renders these as:
 *
 *   { "error": { "code, message, requestId, details } }
 *
 * Cross-tenant access is deliberately reported as `not_found` (404), never 403 —
 * no existence disclosure (docs/api.md, docs/security.md).
 */

export type ErrorClass =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'rate_limited'
  | 'internal';

const STATUS_BY_CLASS: Record<ErrorClass, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
};

export interface AppErrorDetail {
  path?: string;
  message: string;
}

export interface AppErrorOptions {
  errorClass: ErrorClass;
  code: string;
  message: string;
  details?: AppErrorDetail[];
  cause?: unknown;
}

export class AppError extends Error {
  readonly errorClass: ErrorClass;
  readonly code: string;
  readonly httpStatus: number;
  readonly details: AppErrorDetail[];
  readonly expected = true;

  constructor(opts: AppErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'AppError';
    this.errorClass = opts.errorClass;
    this.code = opts.code;
    this.httpStatus = STATUS_BY_CLASS[opts.errorClass];
    this.details = opts.details ?? [];
  }

  static validation(code: string, message: string, details?: AppErrorDetail[]): AppError {
    return new AppError({ errorClass: 'validation', code, message, details });
  }

  static unauthenticated(code = 'auth.unauthenticated', message = 'Authentication required.'): AppError {
    return new AppError({ errorClass: 'unauthenticated', code, message });
  }

  static forbidden(code = 'auth.forbidden', message = 'You do not have permission to do that.'): AppError {
    return new AppError({ errorClass: 'forbidden', code, message });
  }

  static notFound(code: string, message = 'Resource not found.'): AppError {
    return new AppError({ errorClass: 'not_found', code, message });
  }

  static conflict(code: string, message: string): AppError {
    return new AppError({ errorClass: 'conflict', code, message });
  }

  static unprocessable(code: string, message: string, details?: AppErrorDetail[]): AppError {
    return new AppError({ errorClass: 'unprocessable', code, message, details });
  }

  static rateLimited(code = 'rate.limited', message = 'Too many requests.'): AppError {
    return new AppError({ errorClass: 'rate_limited', code, message });
  }

  static internal(code = 'internal.error', message = 'Something went wrong.', cause?: unknown): AppError {
    return new AppError({ errorClass: 'internal', code, message, cause });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
