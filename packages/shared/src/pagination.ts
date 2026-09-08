import { z } from 'zod';

/** Cursor pagination shared by every list endpoint (docs/api.md). */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  data: T[];
  nextCursor?: string;
}

export function page<T>(data: T[], nextCursor?: string): Page<T> {
  return nextCursor === undefined ? { data } : { data, nextCursor };
}
