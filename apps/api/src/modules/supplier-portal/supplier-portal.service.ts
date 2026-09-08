import { Injectable } from '@nestjs/common';
import {
  SUPPLIER_QUESTIONNAIRE,
  findQuestion,
  questionnaireCompleteness,
  validateResponses,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import {
  recomputeSupplierPassport,
  withOrgContext,
  writeAuditLog,
  type Prisma,
  type TenantDb,
} from '@trace/db';

export interface AddEvidenceInput {
  type: string;
  title: string;
  sourceUrl?: string;
  note?: string;
  reportingPeriod?: string;
  requestId?: string;
  documentId?: string;
}

@Injectable()
export class SupplierPortalService {
  async overview(organizationId: string, supplierId: string): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const s = await this.supplierOrThrow(db, organizationId, supplierId);
      const [openRequests, evidenceCount, passport] = await Promise.all([
        db.supplierRequest.count({
          where: { supplierId, status: { in: ['sent', 'in_progress'] } },
        }),
        db.supplierEvidenceRef.count({ where: { supplierId } }),
        db.supplierPassport.findFirst({
          where: { supplierId },
          orderBy: { version: 'desc' },
          select: { completeness: true, computedAt: true, version: true },
        }),
      ]);
      return {
        supplier: {
          id: s.id,
          name: s.name,
          country: s.country,
          industryNace: s.industryNace,
          registrationIds: s.registrationIds,
        },
        relationship: s.relationship
          ? { category: s.relationship.category, tier: s.relationship.tier }
          : null,
        openRequests,
        evidenceCount,
        passport: passport
          ? {
              version: passport.version,
              completeness: passport.completeness,
              computedAt: passport.computedAt.toISOString(),
            }
          : null,
      };
    });
  }

  async updateProfile(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    input: { industryNace?: string | null; registrationIds?: Record<string, string> },
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      await this.supplierOrThrow(db, organizationId, supplierId);
      await db.supplier.update({
        where: { id: supplierId },
        data: {
          ...(input.industryNace !== undefined ? { industryNace: input.industryNace } : {}),
          ...(input.registrationIds !== undefined ? { registrationIds: input.registrationIds } : {}),
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.profile_updated_by_supplier',
        resourceType: 'supplier',
        resourceId: supplierId,
        before: null,
        after: input,
        requestId,
      });
    });
  }

  async listRequests(organizationId: string, supplierId: string): Promise<unknown[]> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.supplierRequest.findMany({
        where: { organizationId, supplierId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        message: r.message,
        status: r.status,
        completeness: questionnaireCompleteness((r.responses ?? {}) as Record<string, unknown>),
        dueOn: r.dueOn?.toISOString().slice(0, 10) ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
      }));
    });
  }

  async getRequest(
    organizationId: string,
    supplierId: string,
    requestId: string,
  ): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const r = await this.requestOrThrow(db, organizationId, supplierId, requestId);
      return {
        id: r.id,
        title: r.title,
        message: r.message,
        status: r.status,
        templateVersion: r.templateVersion,
        sections: SUPPLIER_QUESTIONNAIRE,
        responses: r.responses ?? {},
        completeness: questionnaireCompleteness((r.responses ?? {}) as Record<string, unknown>),
        dueOn: r.dueOn?.toISOString().slice(0, 10) ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
      };
    });
  }

  async saveResponses(
    organizationId: string,
    supplierId: string,
    requestId: string,
    actorUserId: string,
    responses: Record<string, unknown>,
    reqId: string,
  ): Promise<{ completeness: number }> {
    return withOrgContext(organizationId, async (db) => {
      const r = await this.requestOrThrow(db, organizationId, supplierId, requestId);
      if (r.status === 'submitted' || r.status === 'accepted') {
        throw AppError.conflict('request.locked', 'This questionnaire has already been submitted.');
      }
      const cleaned = pickKnown(responses);
      await db.supplierRequest.update({
        where: { id: r.id },
        data: {
          responses: cleaned as Prisma.InputJsonValue,
          status: r.status === 'sent' ? 'in_progress' : r.status,
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.request_responses_saved',
        resourceType: 'supplier_request',
        resourceId: r.id,
        before: null,
        after: { keys: Object.keys(cleaned).length },
        requestId: reqId,
      });
      return { completeness: questionnaireCompleteness(cleaned) };
    });
  }

  async submit(
    organizationId: string,
    supplierId: string,
    requestId: string,
    actorUserId: string,
    reqId: string,
  ): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const r = await this.requestOrThrow(db, organizationId, supplierId, requestId);
      if (r.status === 'submitted' || r.status === 'accepted') {
        throw AppError.conflict('request.locked', 'This questionnaire has already been submitted.');
      }
      const responses = (r.responses ?? {}) as Record<string, unknown>;
      const issues = validateResponses(responses);
      if (issues.length > 0) {
        throw AppError.unprocessable(
          'request.incomplete',
          'The questionnaire has unanswered required questions or invalid values.',
          issues.map((i) => ({ path: i.questionId, message: i.message })),
        );
      }

      await db.supplierRequest.update({
        where: { id: r.id },
        data: { status: 'submitted', submittedAt: new Date(), submittedByUserId: actorUserId },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.request_submitted',
        resourceType: 'supplier_request',
        resourceId: r.id,
        before: { status: r.status },
        after: { status: 'submitted' },
        requestId: reqId,
      });

      return recomputeSupplierPassport(db, {
        organizationId,
        supplierId,
        computedByUserId: actorUserId,
        requestId: reqId,
      });
    });
  }

  async listEvidence(organizationId: string, supplierId: string): Promise<unknown[]> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.supplierEvidenceRef.findMany({
        where: { organizationId, supplierId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        sourceUrl: e.sourceUrl,
        note: e.note,
        reportingPeriod: e.reportingPeriod,
        verified: e.verified,
        createdAt: e.createdAt.toISOString(),
      }));
    });
  }

  async addEvidence(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    input: AddEvidenceInput,
    reqId: string,
  ): Promise<{ id: string }> {
    return withOrgContext(organizationId, async (db) => {
      await this.supplierOrThrow(db, organizationId, supplierId);
      if (input.requestId) {
        await this.requestOrThrow(db, organizationId, supplierId, input.requestId);
      }
      if (input.documentId) {
        const doc = await db.document.findFirst({
          where: { id: input.documentId, organizationId },
          select: { id: true },
        });
        if (!doc) throw AppError.unprocessable('evidence.document_not_found', 'Document not found.');
      }
      const row = await db.supplierEvidenceRef.create({
        data: {
          organizationId,
          supplierId,
          requestId: input.requestId ?? null,
          documentId: input.documentId ?? null,
          type: input.type as never,
          title: input.title,
          sourceUrl: input.sourceUrl ?? null,
          note: input.note ?? null,
          reportingPeriod: input.reportingPeriod ?? null,
          submittedByUserId: actorUserId,
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.evidence_added',
        resourceType: 'supplier_evidence_ref',
        resourceId: row.id,
        before: null,
        after: { supplierId, type: input.type, title: input.title },
        requestId: reqId,
      });
      return { id: row.id };
    });
  }

  private async supplierOrThrow(db: TenantDb, organizationId: string, supplierId: string) {
    const s = await db.supplier.findFirst({
      where: { id: supplierId, organizationId },
      include: { relationship: true },
    });
    if (!s) throw AppError.notFound('supplier.not_found', 'Supplier not found.');
    return s;
  }

  private async requestOrThrow(
    db: TenantDb,
    organizationId: string,
    supplierId: string,
    requestId: string,
  ) {
    const r = await db.supplierRequest.findFirst({
      where: { id: requestId, organizationId, supplierId },
    });
    if (!r) throw AppError.notFound('request.not_found', 'Request not found.');
    return r;
  }
}

/** Keep only responses whose key is a known question id. */
function pickKnown(responses: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(responses)) {
    if (findQuestion(k)) out[k] = v;
  }
  return out;
}
