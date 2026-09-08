import { type PipeTransform } from '@nestjs/common';
import { AppError } from '@trace/shared';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

/**
 * Validates a request payload against a Zod schema and yields the parsed,
 * typed value. Usage: `@Body(new ZodPipe(createOrgSchema)) body: CreateOrgInput`.
 */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, ZodInfer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): ZodInfer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppError.validation(
        'request.invalid',
        'The request payload failed validation.',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.') || undefined,
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
