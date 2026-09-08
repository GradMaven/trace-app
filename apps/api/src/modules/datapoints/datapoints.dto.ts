import { z } from 'zod';
import { DATA_LABEL, PROVENANCE } from '@trace/shared';

export const createDatapointSchema = z
  .object({
    metricKey: z.string().min(1).max(120),
    valueNumeric: z.number().optional(),
    valueText: z.string().max(2000).optional(),
    unit: z.string().max(40).optional(),
    provenance: z.enum(PROVENANCE as unknown as [string, ...string[]]),
    label: z.enum(DATA_LABEL as unknown as [string, ...string[]]).optional(),
    reportingPeriod: z.string().max(60).optional(),
    subjectType: z.enum(['organization', 'business_unit', 'supplier', 'facility', 'product']),
    subjectId: z.string().uuid(),
  })
  .refine((v) => v.valueNumeric !== undefined || v.valueText !== undefined, {
    message: 'Provide valueNumeric or valueText.',
    path: ['valueNumeric'],
  });
export type CreateDatapointInput = z.infer<typeof createDatapointSchema>;

export const listDatapointsQuerySchema = z.object({
  subjectType: z.string().max(40).optional(),
  subjectId: z.string().uuid().optional(),
  metricKey: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});
export type ListDatapointsQuery = z.infer<typeof listDatapointsQuerySchema>;
