import { Injectable } from '@nestjs/common';
import { AppError, page, type Page } from '@trace/shared';
import { withOrgContext, writeAuditLog, type TenantDb } from '@trace/db';
import { isKnownUnit } from '@trace/domain';
import type {
  CreateActivityInput,
  ListActivityQuery,
  UpdateActivityInput,
} from './activity-data.dto';

export interface ActivityListItem {
  id: string;
  scope: string;
  ghgCategory: string | null;
  category: string;
  description: string | null;
  value: string;
  unit: string;
  reportingPeriod: string;
  provenance: string;
  subjectType: string;
  subjectId: string;
  evidenceCount: number;
  calculationCount: number;
  createdAt: string;
}

@Injectable()
export class ActivityDataService {
  private assertUnit(unit: string): void {
    if (!isKnownUnit(unit)) {
      throw AppError.unprocessable('activity.unknown_unit', `Unknown unit: "${unit}".`);
    }
  }

  async create(
    organizationId: string,
    actorUserId: string,
    input: CreateActivityInput,
    requestId: string,
  ): Promise<{ id: string }> {
    this.assertUnit(input.unit);
    return withOrgContext(organizationId, async (db) => {
      const row = await db.activityData.create({
        data: {
          organizationId,
          scope: input.scope as never,
          ghgCategory: (input.ghgCategory as never) ?? null,
          category: input.category,
          description: input.description ?? null,
          value: input.value,
          unit: input.unit,
          reportingPeriod: input.reportingPeriod,
          provenance: (input.provenance as never) ?? 'supplier_reported',
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          supplierId: input.supplierId ?? null,
          sourceRef: input.sourceRef ?? null,
          occurredOn: input.occurredOn ? new Date(input.occurredOn) : null,
          createdByUserId: actorUserId,
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'activity.created',
        resourceType: 'activity_data',
        resourceId: row.id,
        before: null,
        after: { scope: input.scope, category: input.category, value: input.value, unit: input.unit },
        requestId,
      });
      return { id: row.id };
    });
  }

  async list(
    organizationId: string,
    query: ListActivityQuery,
  ): Promise<Page<ActivityListItem>> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.activityData.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(query.scope ? { scope: query.scope as never } : {}),
          ...(query.reportingPeriod ? { reportingPeriod: query.reportingPeriod } : {}),
          ...(query.subjectType ? { subjectType: query.subjectType } : {}),
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        },
        include: { _count: { select: { evidence: true, calculations: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((a) => ({
        id: a.id,
        scope: a.scope,
        ghgCategory: a.ghgCategory,
        category: a.category,
        description: a.description,
        value: a.value.toString(),
        unit: a.unit,
        reportingPeriod: a.reportingPeriod,
        provenance: a.provenance,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        evidenceCount: a._count.evidence,
        calculationCount: a._count.calculations,
        createdAt: a.createdAt.toISOString(),
      }));
      return page(items, hasMore ? items[items.length - 1]!.id : undefined);
    });
  }

  async get(organizationId: string, id: string): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const a = await db.activityData.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: {
          evidence: {
            include: {
              evidence: { select: { id: true, title: true, type: true, status: true } },
            },
          },
          calculations: {
            orderBy: { calculatedAt: 'desc' },
            select: {
              id: true,
              methodology: true,
              resultValueTco2e: true,
              calculationVersion: true,
              calculatedAt: true,
              supersededBy: { select: { id: true } },
            },
          },
        },
      });
      if (!a) throw AppError.notFound('activity.not_found', 'Activity data not found.');
      return {
        id: a.id,
        scope: a.scope,
        ghgCategory: a.ghgCategory,
        category: a.category,
        description: a.description,
        value: a.value.toString(),
        unit: a.unit,
        reportingPeriod: a.reportingPeriod,
        provenance: a.provenance,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        supplierId: a.supplierId,
        sourceRef: a.sourceRef,
        occurredOn: a.occurredOn?.toISOString().slice(0, 10) ?? null,
        createdAt: a.createdAt.toISOString(),
        evidence: a.evidence.map((e) => ({
          id: e.evidence.id,
          title: e.evidence.title,
          type: e.evidence.type,
          status: e.evidence.status,
          linkedAt: e.linkedAt.toISOString(),
        })),
        calculations: a.calculations.map((c) => ({
          id: c.id,
          methodology: c.methodology,
          resultValueTco2e: c.resultValueTco2e.toString(),
          calculationVersion: c.calculationVersion,
          calculatedAt: c.calculatedAt.toISOString(),
          current: c.supersededBy.length === 0,
        })),
      };
    });
  }

  async update(
    organizationId: string,
    id: string,
    actorUserId: string,
    input: UpdateActivityInput,
    requestId: string,
  ): Promise<void> {
    if (input.unit) this.assertUnit(input.unit);
    await withOrgContext(organizationId, async (db) => {
      const before = await this.loadOrThrow(db, organizationId, id);
      await db.activityData.update({
        where: { id },
        data: {
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.provenance !== undefined ? { provenance: input.provenance as never } : {}),
          ...(input.ghgCategory !== undefined ? { ghgCategory: input.ghgCategory as never } : {}),
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'activity.updated',
        resourceType: 'activity_data',
        resourceId: id,
        before: { value: before.value.toString(), unit: before.unit },
        after: input,
        requestId,
      });
    });
  }

  async softDelete(
    organizationId: string,
    id: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      const a = await this.loadOrThrow(db, organizationId, id);
      const calcCount = await db.calculation.count({ where: { activityId: id } });
      if (calcCount > 0) {
        throw AppError.conflict(
          'activity.has_calculations',
          'This activity has calculations and cannot be deleted.',
        );
      }
      await db.activityData.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'activity.deleted',
        resourceType: 'activity_data',
        resourceId: id,
        before: { category: a.category },
        after: null,
        requestId,
      });
    });
  }

  async linkEvidence(
    organizationId: string,
    activityId: string,
    evidenceId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      await this.loadOrThrow(db, organizationId, activityId);
      const ev = await db.evidence.findFirst({
        where: { id: evidenceId, organizationId },
        select: { id: true },
      });
      if (!ev) throw AppError.notFound('evidence.not_found', 'Evidence not found.');
      await db.activityEvidence.upsert({
        where: { activityId_evidenceId: { activityId, evidenceId } },
        create: { organizationId, activityId, evidenceId, linkedByUserId: actorUserId },
        update: {},
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'activity.linked_evidence',
        resourceType: 'activity_data',
        resourceId: activityId,
        before: null,
        after: { evidenceId },
        requestId,
      });
    });
  }

  async unlinkEvidence(
    organizationId: string,
    activityId: string,
    evidenceId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      await db.activityEvidence.deleteMany({ where: { activityId, evidenceId, organizationId } });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'activity.unlinked_evidence',
        resourceType: 'activity_data',
        resourceId: activityId,
        before: { evidenceId },
        after: null,
        requestId,
      });
    });
  }

  private async loadOrThrow(db: TenantDb, organizationId: string, id: string) {
    const a = await db.activityData.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!a) throw AppError.notFound('activity.not_found', 'Activity data not found.');
    return a;
  }
}
