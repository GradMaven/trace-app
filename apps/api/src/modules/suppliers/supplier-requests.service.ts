import { Injectable } from '@nestjs/common';
import {
  QUESTIONNAIRE_VERSION,
  SUPPLIER_QUESTIONNAIRE,
  questionnaireCompleteness,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { recomputeSupplierPassport, withOrgContext, writeAuditLog } from '@trace/db';

export interface CreateRequestInput {
  title?: string;
  message?: string;
  dueOn?: string;
}

@Injectable()
export class SupplierRequestsService {
  async create(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    input: CreateRequestInput,
    requestId: string,
  ): Promise<{ id: string }> {
    return withOrgContext(organizationId, async (db) => {
      const supplier = await db.supplier.findFirst({
        where: { id: supplierId, organizationId, deletedAt: null },
      });
      if (!supplier) throw AppError.notFound('supplier.not_found', 'Supplier not found.');

      const openExists = await db.supplierRequest.findFirst({
        where: {
          supplierId,
          kind: 'sustainability_questionnaire',
          status: { in: ['draft', 'sent', 'in_progress'] },
        },
      });
      if (openExists) {
        throw AppError.conflict(
          'supplier.request_open',
          'There is already an open sustainability questionnaire for this supplier.',
        );
      }

      const req = await db.supplierRequest.create({
        data: {
          organizationId,
          supplierId,
          kind: 'sustainability_questionnaire',
          templateVersion: QUESTIONNAIRE_VERSION,
          title: input.title?.trim() || 'Sustainability questionnaire',
          message: input.message ?? null,
          status: 'sent',
          dueOn: input.dueOn ? new Date(input.dueOn) : null,
          createdByUserId: actorUserId,
          sentAt: new Date(),
        },
      });

      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.request_sent',
        resourceType: 'supplier_request',
        resourceId: req.id,
        before: null,
        after: { supplierId, templateVersion: QUESTIONNAIRE_VERSION, dueOn: input.dueOn ?? null },
        requestId,
      });

      return { id: req.id };
    });
  }

  async listAll(organizationId: string, status?: string): Promise<unknown[]> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.supplierRequest.findMany({
        where: { organizationId, ...(status ? { status: status as never } : {}) },
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        supplier: r.supplier,
        title: r.title,
        status: r.status,
        completeness: questionnaireCompleteness((r.responses ?? {}) as Record<string, unknown>),
        dueOn: r.dueOn?.toISOString().slice(0, 10) ?? null,
        sentAt: r.sentAt?.toISOString() ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
      }));
    });
  }

  async list(organizationId: string, supplierId: string): Promise<unknown[]> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.supplierRequest.findMany({
        where: { organizationId, supplierId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        templateVersion: r.templateVersion,
        completeness: questionnaireCompleteness((r.responses ?? {}) as Record<string, unknown>),
        dueOn: r.dueOn?.toISOString().slice(0, 10) ?? null,
        sentAt: r.sentAt?.toISOString() ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      }));
    });
  }

  async get(organizationId: string, requestId: string): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const r = await db.supplierRequest.findFirst({
        where: { id: requestId, organizationId },
        include: { supplier: { select: { id: true, name: true } } },
      });
      if (!r) throw AppError.notFound('request.not_found', 'Request not found.');
      return {
        id: r.id,
        supplier: r.supplier,
        title: r.title,
        message: r.message,
        status: r.status,
        templateVersion: r.templateVersion,
        sections: SUPPLIER_QUESTIONNAIRE,
        responses: r.responses ?? {},
        completeness: questionnaireCompleteness((r.responses ?? {}) as Record<string, unknown>),
        dueOn: r.dueOn?.toISOString().slice(0, 10) ?? null,
        sentAt: r.sentAt?.toISOString() ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      };
    });
  }

  async accept(
    organizationId: string,
    requestId: string,
    actorUserId: string,
    reqId: string,
  ): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const r = await db.supplierRequest.findFirst({ where: { id: requestId, organizationId } });
      if (!r) throw AppError.notFound('request.not_found', 'Request not found.');
      if (r.status !== 'submitted') {
        throw AppError.conflict('request.not_submitted', 'Only a submitted request can be accepted.');
      }
      await db.supplierRequest.update({
        where: { id: r.id },
        data: { status: 'accepted', reviewedAt: new Date() },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.request_accepted',
        resourceType: 'supplier_request',
        resourceId: r.id,
        before: { status: 'submitted' },
        after: { status: 'accepted' },
        requestId: reqId,
      });
      return recomputeSupplierPassport(db, {
        organizationId,
        supplierId: r.supplierId,
        computedByUserId: actorUserId,
        requestId: reqId,
      });
    });
  }
}
