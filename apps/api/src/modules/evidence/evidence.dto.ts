import { z } from 'zod';
import { EVIDENCE_STATUS, EVIDENCE_TYPE } from '@trace/shared';

export const createEvidenceSchema = z.object({
  type: z.enum(EVIDENCE_TYPE as unknown as [string, ...string[]]),
  title: z.string().min(1).max(200),
  documentId: z.string().uuid().optional(),
  source: z.string().max(80).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  reportingPeriod: z.string().max(60).optional(),
  issuer: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type CreateEvidenceInput = z.infer<typeof createEvidenceSchema>;

export const listEvidenceQuerySchema = z.object({
  type: z.enum(EVIDENCE_TYPE as unknown as [string, ...string[]]).optional(),
  status: z.enum(EVIDENCE_STATUS as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});
export type ListEvidenceQuery = z.infer<typeof listEvidenceQuerySchema>;

export const transitionEvidenceSchema = z.object({
  to: z.enum(EVIDENCE_STATUS as unknown as [string, ...string[]]),
  method: z.string().max(80).optional(),
  note: z.string().max(2000).optional(),
});
export type TransitionEvidenceBody = z.infer<typeof transitionEvidenceSchema>;

export const supersedeEvidenceSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  documentId: z.string().uuid().nullable().optional(),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  reportingPeriod: z.string().max(60).nullable().optional(),
  issuer: z.string().max(200).nullable().optional(),
});
export type SupersedeEvidenceBody = z.infer<typeof supersedeEvidenceSchema>;

export const linkDatapointSchema = z.object({
  datapointId: z.string().uuid(),
});
export type LinkDatapointBody = z.infer<typeof linkDatapointSchema>;
