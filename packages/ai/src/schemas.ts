import { z } from 'zod';

/**
 * Structured-output contracts for the AI capabilities. Every model response is
 * validated against one of these before it is used; a response that does not
 * parse is rejected (ADR-005).
 */

export const CLASSIFICATION_DOC_TYPES = [
  'supplier_report',
  'certificate',
  'invoice',
  'utility_bill',
  'epd',
  'lca',
  'audit_report',
  'questionnaire',
  'other',
] as const;

export const classificationSchema = z.object({
  documentType: z.enum(CLASSIFICATION_DOC_TYPES),
  issuer: z.string().max(200).nullable(),
  reportingPeriod: z.string().max(60).nullable(),
  confidence: z.number().min(0).max(100),
});
export type ClassificationResult = z.infer<typeof classificationSchema>;

export const candidateSchema = z.object({
  metricKey: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  valueNumeric: z.number().nullable(),
  valueText: z.string().max(500).nullable(),
  unit: z.string().max(40).nullable(),
  reportingPeriod: z.string().max(60).nullable(),
  provenanceGuess: z
    .enum(['measured', 'supplier_reported', 'calculated', 'estimated', 'modeled', 'inferred'])
    .default('supplier_reported'),
  confidence: z.number().min(0).max(100),
  /** The exact snippet the value was read from — used to compute source spans. */
  sourceText: z.string().min(1).max(600),
  rationale: z.string().max(600),
});
export type CandidateOutput = z.infer<typeof candidateSchema>;

export const extractionSchema = z.object({
  documentType: z.string().max(60),
  issuer: z.string().max(200).nullable(),
  reportingPeriod: z.string().max(60).nullable(),
  candidates: z.array(candidateSchema).max(50),
});
export type ExtractionResult = z.infer<typeof extractionSchema>;

/**
 * Ask TRACE (Phase 10). The model NEVER authors a query and NEVER answers a
 * factual question about the tenant from parametric knowledge. It only (1) maps
 * a free-text question to one of these fixed intents, and (2) composes an answer
 * from a set of numbered records that `@trace/db` retrieved with hand-written,
 * tenant-scoped queries.
 */
export const ASK_INTENTS = [
  'emissions_summary',
  'emissions_trend',
  'top_scope3_categories',
  'top_suppliers_by_emissions',
  'missing_evidence',
  'estimated_datapoints',
  'outdated_factors',
  'low_trust_datapoints',
  'compliance_gaps',
  'open_findings',
  'data_quality_issues',
  'unsupported',
] as const;
export type AskIntent = (typeof ASK_INTENTS)[number];

export const askIntentSchema = z.object({
  intent: z.enum(ASK_INTENTS),
  reportingPeriod: z.string().max(60).nullable(),
  comparePeriod: z.string().max(60).nullable(),
  confidence: z.number().min(0).max(100),
});
export type AskIntentResult = z.infer<typeof askIntentSchema>;

export const askAnswerSchema = z.object({
  answer: z.string().min(1).max(4000),
  /** The record numbers the answer relies on. Empty means "the records do not answer this". */
  citedRefs: z.array(z.number().int().min(1).max(200)).max(40),
});
export type AskAnswerResult = z.infer<typeof askAnswerSchema>;
