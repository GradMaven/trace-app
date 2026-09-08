import {
  classifyDocument,
  extractDatapoints,
  locateSpan,
  parseDocument,
  UnsupportedDocumentError,
  type AIProvider,
  type ClassificationResult,
  type ParsedDocument,
  type StructuredResult,
} from '@trace/ai';
import { AppError, type EvidenceType, type Provenance } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Document extraction pipeline (ADR-005). Deterministic pre-processing first
 * (parse text), then classification, then structured extraction — each model
 * call recorded as an `ai_job` before its output is used. Output lands in
 * `candidate_datapoint` (status `pending`); nothing here writes trusted data.
 *
 * `fetchBytes` is injected so `@trace/db` need not depend on `@trace/storage`.
 */

export interface PipelineDeps {
  provider: AIProvider;
  fetchBytes: (storageKey: string) => Promise<Buffer>;
}

export interface RunExtractionArgs {
  organizationId: string;
  documentId: string;
  actorUserId: string;
  requestId: string;
}

export interface RunExtractionResult {
  extractionId: string;
  status: string;
  candidateCount: number;
  aiJobIds: string[];
  classification: ClassificationResult | null;
  error?: string;
}

const DOC_TYPE_TO_EVIDENCE: Record<string, EvidenceType> = {
  supplier_report: 'supplier_report',
  certificate: 'certificate',
  invoice: 'invoice',
  utility_bill: 'utility_bill',
  epd: 'epd',
  lca: 'lca',
  audit_report: 'audit_report',
  questionnaire: 'questionnaire',
  other: 'external_dataset',
};

async function recordAiJob<T>(
  db: TenantDb,
  base: {
    organizationId: string;
    capability: string;
    promptVersion: string;
    inputType: string;
    inputRef: string;
    documentId: string;
  },
  call: () => Promise<StructuredResult<T>>,
): Promise<{ jobId: string; result: StructuredResult<T> }> {
  const job = await db.aiJob.create({
    data: {
      organizationId: base.organizationId,
      capability: base.capability,
      provider: 'pending',
      model: 'pending',
      promptVersion: base.promptVersion,
      inputType: base.inputType,
      inputRef: base.inputRef,
      documentId: base.documentId,
      status: 'running',
    },
  });
  try {
    const result = await call();
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        provider: result.provider,
        model: result.model,
        status: 'completed',
        output: result.output as Prisma.InputJsonValue,
        confidence: result.confidence,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costEur: result.costEur,
        latencyMs: result.latencyMs,
        completedAt: new Date(),
      },
    });
    return { jobId: job.id, result };
  } catch (err) {
    await db.aiJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

export async function runExtractionPipeline(
  db: TenantDb,
  deps: PipelineDeps,
  args: RunExtractionArgs,
): Promise<RunExtractionResult> {
  const document = await db.document.findFirst({
    where: { id: args.documentId, organizationId: args.organizationId },
  });
  if (!document) throw AppError.notFound('document.not_found', 'Document not found.');

  const extraction = await db.documentExtraction.upsert({
    where: { documentId: document.id },
    create: {
      organizationId: args.organizationId,
      documentId: document.id,
      status: 'parsing',
    },
    update: { status: 'parsing', error: null, aiJobIds: [], candidateCount: 0 },
  });

  // Clear any prior pending candidates for a clean re-run.
  await db.candidateDatapoint.deleteMany({
    where: { documentId: document.id, status: 'pending' },
  });

  let parsed: ParsedDocument;
  try {
    const bytes = await deps.fetchBytes(document.storageKey);
    parsed = await parseDocument({ buffer: bytes, mime: document.mime, filename: document.filename });
  } catch (err) {
    const message =
      err instanceof UnsupportedDocumentError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Failed to read the document.';
    await db.documentExtraction.update({
      where: { id: extraction.id },
      data: { status: 'failed', error: message },
    });
    return {
      extractionId: extraction.id,
      status: 'failed',
      candidateCount: 0,
      aiJobIds: [],
      classification: null,
      error: message,
    };
  }

  await db.documentExtraction.update({
    where: { id: extraction.id },
    data: {
      status: 'classifying',
      parser: parsed.parser,
      parsedText: parsed.text,
      pageCount: parsed.pageCount,
      truncated: parsed.truncated,
    },
  });

  const aiJobIds: string[] = [];

  const { jobId: classifyJobId, result: classification } = await recordAiJob(
    db,
    {
      organizationId: args.organizationId,
      capability: 'classification',
      promptVersion: 'classification/document@1',
      inputType: 'document',
      inputRef: document.id,
      documentId: document.id,
    },
    () => classifyDocument(deps.provider, { text: parsed.text, filename: document.filename }),
  );
  aiJobIds.push(classifyJobId);

  await db.documentExtraction.update({
    where: { id: extraction.id },
    data: {
      status: 'extracting',
      classification: classification.output as unknown as Prisma.InputJsonValue,
    },
  });

  const { jobId: extractJobId, result: extractionResult } = await recordAiJob(
    db,
    {
      organizationId: args.organizationId,
      capability: 'extraction',
      promptVersion: 'extraction/supplier-report@1',
      inputType: 'document',
      inputRef: document.id,
      documentId: document.id,
    },
    () =>
      extractDatapoints(deps.provider, {
        text: parsed.text,
        filename: document.filename,
        classification: classification.output,
      }),
  );
  aiJobIds.push(extractJobId);

  let created = 0;
  for (const cand of extractionResult.output.candidates) {
    const span = locateSpan(parsed, cand.sourceText);
    await db.candidateDatapoint.create({
      data: {
        organizationId: args.organizationId,
        documentId: document.id,
        extractionId: extraction.id,
        aiJobId: extractJobId,
        metricKey: cand.metricKey,
        label: cand.label,
        valueNumeric: cand.valueNumeric ?? null,
        valueText: cand.valueText ?? null,
        unit: cand.unit ?? null,
        reportingPeriod: cand.reportingPeriod ?? null,
        provenanceGuess: cand.provenanceGuess as never,
        confidence: cand.confidence,
        sourceSpans: [span] as unknown as Prisma.InputJsonValue,
        rationale: cand.rationale,
        status: 'pending',
      },
    });
    created += 1;
  }

  await db.documentExtraction.update({
    where: { id: extraction.id },
    data: { status: 'ready_for_review', aiJobIds, candidateCount: created },
  });
  await db.document.update({
    where: { id: document.id },
    data: { processingStatus: 'scanned' },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'document.extraction_completed',
    resourceType: 'document_extraction',
    resourceId: extraction.id,
    before: null,
    after: {
      documentId: document.id,
      provider: extractionResult.provider,
      model: extractionResult.model,
      candidates: created,
      classification: classification.output.documentType,
    },
    requestId: args.requestId,
  });

  return {
    extractionId: extraction.id,
    status: 'ready_for_review',
    candidateCount: created,
    aiJobIds,
    classification: classification.output,
  };
}

export interface PromoteCandidateArgs {
  organizationId: string;
  candidateId: string;
  actorUserId: string;
  subjectType: string;
  subjectId: string;
  provenance?: Provenance;
  valueNumeric?: number;
  valueText?: string;
  unit?: string;
  note?: string;
  requestId: string;
}

export async function promoteCandidate(
  db: TenantDb,
  args: PromoteCandidateArgs,
): Promise<{ datapointId: string; evidenceId: string }> {
  const cand = await db.candidateDatapoint.findFirst({
    where: { id: args.candidateId, organizationId: args.organizationId },
    include: { document: true },
  });
  if (!cand) throw AppError.notFound('candidate.not_found', 'Candidate not found.');
  if (cand.status !== 'pending') {
    throw AppError.conflict('candidate.reviewed', 'This candidate has already been reviewed.');
  }

  // Ensure an evidence record backed by the source document.
  let evidence = await db.evidence.findFirst({
    where: { organizationId: args.organizationId, documentId: cand.documentId },
    orderBy: { version: 'desc' },
  });
  if (!evidence) {
    const classification = (await db.documentExtraction.findUnique({
      where: { documentId: cand.documentId },
      select: { classification: true },
    })) as { classification: { documentType?: string } | null } | null;
    const docType = classification?.classification?.documentType ?? 'other';
    evidence = await db.evidence.create({
      data: {
        organizationId: args.organizationId,
        type: (DOC_TYPE_TO_EVIDENCE[docType] ?? 'external_dataset') as never,
        title: cand.document.filename,
        documentId: cand.documentId,
        source: 'ai_extraction',
        reportingPeriod: cand.reportingPeriod,
        hash: cand.document.checksumSha256,
        metadata: { origin: 'candidate_promotion' },
        status: 'extracted',
        uploadedByUserId: args.actorUserId,
      },
    });
  }

  const datapoint = await db.datapoint.create({
    data: {
      organizationId: args.organizationId,
      metricKey: cand.metricKey,
      valueNumeric: args.valueNumeric ?? cand.valueNumeric ?? null,
      valueText: args.valueText ?? cand.valueText ?? null,
      unit: args.unit ?? cand.unit ?? null,
      provenance: (args.provenance ?? (cand.provenanceGuess as Provenance)) as never,
      label: 'human_reviewed',
      reportingPeriod: cand.reportingPeriod,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      createdByUserId: args.actorUserId,
    },
  });

  await db.datapointEvidence.upsert({
    where: { datapointId_evidenceId: { datapointId: datapoint.id, evidenceId: evidence.id } },
    create: {
      organizationId: args.organizationId,
      datapointId: datapoint.id,
      evidenceId: evidence.id,
      linkedByUserId: args.actorUserId,
    },
    update: {},
  });

  await db.candidateDatapoint.update({
    where: { id: cand.id },
    data: {
      status: 'promoted',
      promotedDatapointId: datapoint.id,
      reviewedByUserId: args.actorUserId,
      reviewedAt: new Date(),
      reviewNote: args.note ?? null,
    },
  });
  if (cand.aiJobId) {
    await db.aiJob.update({ where: { id: cand.aiJobId }, data: { reviewerId: args.actorUserId } });
  }

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'candidate.promoted',
    resourceType: 'candidate_datapoint',
    resourceId: cand.id,
    before: { status: 'pending' },
    after: { datapointId: datapoint.id, evidenceId: evidence.id, metricKey: cand.metricKey },
    requestId: args.requestId,
  });

  return { datapointId: datapoint.id, evidenceId: evidence.id };
}

export async function rejectCandidate(
  db: TenantDb,
  args: { organizationId: string; candidateId: string; actorUserId: string; note?: string; requestId: string },
): Promise<void> {
  const cand = await db.candidateDatapoint.findFirst({
    where: { id: args.candidateId, organizationId: args.organizationId },
  });
  if (!cand) throw AppError.notFound('candidate.not_found', 'Candidate not found.');
  if (cand.status !== 'pending') {
    throw AppError.conflict('candidate.reviewed', 'This candidate has already been reviewed.');
  }
  await db.candidateDatapoint.update({
    where: { id: cand.id },
    data: {
      status: 'rejected',
      reviewedByUserId: args.actorUserId,
      reviewedAt: new Date(),
      reviewNote: args.note ?? null,
    },
  });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'candidate.rejected',
    resourceType: 'candidate_datapoint',
    resourceId: cand.id,
    before: { status: 'pending' },
    after: { status: 'rejected' },
    requestId: args.requestId,
  });
}
