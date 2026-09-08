import { Injectable } from '@nestjs/common';
import { AppError, page, type Page } from '@trace/shared';
import { datapointTrust, withOrgContext, writeAuditLog } from '@trace/db';
import type { CreateDatapointInput, ListDatapointsQuery } from './datapoints.dto';

export interface DatapointView {
  id: string;
  metricKey: string;
  value: string | null;
  valueText: string | null;
  unit: string | null;
  provenance: string;
  label: string;
  reportingPeriod: string | null;
  subjectType: string;
  subjectId: string;
  evidenceCount: number;
  createdAt: string;
}

@Injectable()
export class DatapointsService {
  async create(
    organizationId: string,
    actorUserId: string,
    input: CreateDatapointInput,
    requestId: string,
  ): Promise<{ id: string }> {
    return withOrgContext(organizationId, async (db) => {
      const dp = await db.datapoint.create({
        data: {
          organizationId,
          metricKey: input.metricKey,
          valueNumeric: input.valueNumeric ?? null,
          valueText: input.valueText ?? null,
          unit: input.unit ?? null,
          provenance: input.provenance as never,
          label: (input.label ?? 'human_reviewed') as never,
          reportingPeriod: input.reportingPeriod ?? null,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          createdByUserId: actorUserId,
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'datapoint.created',
        resourceType: 'datapoint',
        resourceId: dp.id,
        before: null,
        after: {
          metricKey: input.metricKey,
          provenance: input.provenance,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
        },
        requestId,
      });
      return { id: dp.id };
    });
  }

  async list(organizationId: string, query: ListDatapointsQuery): Promise<Page<DatapointView>> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.datapoint.findMany({
        where: {
          organizationId,
          ...(query.subjectType ? { subjectType: query.subjectType } : {}),
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
          ...(query.metricKey ? { metricKey: query.metricKey } : {}),
        },
        include: { _count: { select: { evidence: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((d) => this.toView(d));
      return page(items, hasMore ? items[items.length - 1]!.id : undefined);
    });
  }

  async get(organizationId: string, id: string): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const dp = await db.datapoint.findFirst({
        where: { id, organizationId },
        include: {
          evidence: {
            include: {
              evidence: {
                select: {
                  id: true,
                  type: true,
                  title: true,
                  status: true,
                  reportingPeriod: true,
                  documentId: true,
                },
              },
            },
          },
        },
      });
      if (!dp) throw AppError.notFound('datapoint.not_found', 'Datapoint not found.');
      const trust = await datapointTrust(db, organizationId, dp.id);
      return {
        id: dp.id,
        metricKey: dp.metricKey,
        trust,
        value: dp.valueNumeric?.toString() ?? null,
        valueText: dp.valueText,
        unit: dp.unit,
        provenance: dp.provenance,
        label: dp.label,
        reportingPeriod: dp.reportingPeriod,
        subjectType: dp.subjectType,
        subjectId: dp.subjectId,
        createdAt: dp.createdAt.toISOString(),
        evidence: dp.evidence.map((link) => ({
          id: link.evidence.id,
          type: link.evidence.type,
          title: link.evidence.title,
          status: link.evidence.status,
          reportingPeriod: link.evidence.reportingPeriod,
          documentId: link.evidence.documentId,
          linkedAt: link.linkedAt.toISOString(),
        })),
      };
    });
  }

  private toView(d: {
    id: string;
    metricKey: string;
    valueNumeric: { toString(): string } | null;
    valueText: string | null;
    unit: string | null;
    provenance: string;
    label: string;
    reportingPeriod: string | null;
    subjectType: string;
    subjectId: string;
    createdAt: Date;
    _count: { evidence: number };
  }): DatapointView {
    return {
      id: d.id,
      metricKey: d.metricKey,
      value: d.valueNumeric?.toString() ?? null,
      valueText: d.valueText,
      unit: d.unit,
      provenance: d.provenance,
      label: d.label,
      reportingPeriod: d.reportingPeriod,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      evidenceCount: d._count.evidence,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
