import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { SCIM_CONTENT_TYPE } from '@trace/domain';
import type { Response } from 'express';

/** Stamps every SCIM response with `Content-Type: application/scim+json`. */
@Injectable()
export class ScimContentTypeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const res = context.switchToHttp().getResponse<Response>();
    res.type(SCIM_CONTENT_TYPE);
    return next.handle();
  }
}
