import { z } from 'zod';
import { GHG_CATEGORY, GHG_SCOPE, PROVENANCE } from '@trace/shared';

export const createActivitySchema = z.object({
  scope: z.enum(GHG_SCOPE as unknown as [string, ...string[]]),
  ghgCategory: z.enum(GHG_CATEGORY as unknown as [string, ...string[]]).nullish(),
  category: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  value: z.number().nonnegative(),
  unit: z.string().min(1).max(40),
  reportingPeriod: z.string().min(2).max(60),
  provenance: z.enum(PROVENANCE as unknown as [string, ...string[]]).optional(),
  subjectType: z.enum(['organization', 'business_unit', 'supplier', 'facility', 'product']),
  subjectId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  sourceRef: z.string().max(200).optional(),
  occurredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = z.object({
  category: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  value: z.number().nonnegative().optional(),
  unit: z.string().min(1).max(40).optional(),
  provenance: z.enum(PROVENANCE as unknown as [string, ...string[]]).optional(),
  ghgCategory: z.enum(GHG_CATEGORY as unknown as [string, ...string[]]).nullable().optional(),
});
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const listActivityQuerySchema = z.object({
  scope: z.enum(GHG_SCOPE as unknown as [string, ...string[]]).optional(),
  reportingPeriod: z.string().max(60).optional(),
  subjectType: z.string().max(40).optional(),
  subjectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

export const linkEvidenceSchema = z.object({ evidenceId: z.string().uuid() });
