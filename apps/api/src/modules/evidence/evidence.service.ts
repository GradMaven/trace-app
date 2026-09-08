import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { nextStates } from '@trace/domain';
import { AppError, page, type EvidenceStatus, type Permission, type Page } from '@trace/shared';
import {
  supersedeEvidence,
  transitionEvidence,
  withOrgContext,
  writeAuditLog,
  type TenantDb,
} from '@trace/db';
import type {
  CreateEvidenceInput,
  ListEvidenceQuery,
  SupersedeEvidenceBody,
} from './evidence.dto';

export interface EvidenceListItem {
  id: string;
  type: string;
  title: string;
  status: string;
  version: number;
  reportingPeriod: string | null;
  hasDocument: boolean;
  datapointCount: number;
  createdAt: string;
}

@Injectable()
export class EvidenceService {
  async create(
    organizationId: string,
    actorUserId: string,
    input: CreateEvidenceInput,
    requestId: string,
  ): Promise<{ id: string }> {
    return withOrgContext(organizationId, async (db) => {
      let checksum: string | null = null;
      if (input.documentId) {
        const doc = await db.document.findFirst({
          where: { id: input.documentId, organizationId },
          select: { checksumSha256: true },
        });
        if (!doc) throw AppError.unprocessable('evidence.document_not_found', 'Linked document not found.');
        checksum = doc.checksumSha256;
      }

      const hash = createHash('sha256')
        .update(`${input.type}|${checksum ?? input.sourceUrl ?? ''}|${input.reportingPeriod ?? ''}`)
        .digest('hex');

      const ev = await db.evidence.create({
        data: {
          organizationId,
          type: input.type as never,
          title: input.title,
          documentId: input.documentId ?? null,
          source: input.source ?? (input.documentId ? 'upload' : 'manual'),
          sourceUrl: input.sourceUrl ?? null,
          reportingPeriod: input.reportingPeriod ?? null,
          issuer: input.issuer ?? null,
          hash,
          metadata: input.metadata ?? {},
          status: 'uploaded',
          uploadedByUserId: actorUserId,
        },
      });

      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'evidence.created',
        resourceType: 'evidence',
        resourceId: ev.id,
        before: null,
        after: { type: input.type, title: input.title, documentId: input.documentId ?? null },
        requestId,
      });

      return { id: ev.id };
    });
  }

  async list(organizationId: string, query: ListEvidenceQuery): Promise<Page<EvidenceListItem>> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.evidence.findMany({
        where: {
          organizationId,
          ...(query.type ? { type: query.type as never } : {}),
          ...(query.status ? { status: query.status as never } : {}),
        },
        include: { _count: { select: { datapoints: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((e) => ({
        id: e.id,
        type: e.type,
        title: e.title,
        status: e.status,
        version: e.version,
        reportingPeriod: e.reportingPeriod,
        hasDocument: e.documentId !== null,
        datapointCount: e._count.datapoints,
        createdAt: e.createdAt.toISOString(),
      }));
      return page(items, hasMore ? items[items.length - 1]!.id : undefined);
    });
  }

  async get(organizationId: string, id: string): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const e = await db.evidence.findFirst({
        where: { id, organizationId },
        include: {
          document: {
            select: {
              id: true,
              filename: true,
              mime: true,
              sizeBytes: true,
              checksumSha256: true,
              scanStatus: true,
            },
          },
          supersedes: { select: { id: true, version: true, status: true } },
          supersededBy: { select: { id: true, version: true, status: true } },
          verifications: { orderBy: { verifiedAt: 'desc' } },
          datapoints: {
            include: {
              datapoint: {
                select: {
                  id: true,
                  metricKey: true,
                  valueNumeric: true,
                  valueText: true,
                  unit: true,
                  provenance: true,
                  subjectType: true,
                  subjectId: true,
                },
              },
            },
          },
        },
      });
      if (!e) throw AppError.notFound('evidence.not_found', 'Evidence not found.');

      return {
        id: e.id,
        type: e.type,
        title: e.title,
        status: e.status,
        version: e.version,
        source: e.source,
        sourceUrl: e.sourceUrl,
        reportingPeriod: e.reportingPeriod,
        issuer: e.issuer,
        hash: e.hash,
        metadata: e.metadata,
        confidenceScore: e.confidenceScore?.toString() ?? null,
        createdAt: e.createdAt.toISOString(),
        expiresAt: e.expiresAt?.toISOString().slice(0, 10) ?? null,
        nextStates: nextStates(e.status),
        document: e.document
          ? {
              id: e.document.id,
              filename: e.document.filename,
              mime: e.document.mime,
              sizeBytes: e.document.sizeBytes,
              checksumSha256: e.document.checksumSha256,
              scanStatus: e.document.scanStatus,
            }
          : null,
        versionChain: {
          supersedes: e.supersedes,
          supersededBy: e.supersededBy,
        },
        verifications: e.verifications.map((v) => ({
          id: v.id,
          method: v.method,
          outcome: v.outcome,
          verifiedByUserId: v.verifiedByUserId,
          verifiedAt: v.verifiedAt.toISOString(),
          notes: v.notes,
        })),
        datapoints: e.datapoints.map((l) => ({
          id: l.datapoint.id,
          metricKey: l.datapoint.metricKey,
          value: l.datapoint.valueNumeric?.toString() ?? l.datapoint.valueText,
          unit: l.datapoint.unit,
          provenance: l.datapoint.provenance,
          subjectType: l.datapoint.subjectType,
          subjectId: l.datapoint.subjectId,
          linkedAt: l.linkedAt.toISOString(),
        })),
      };
    });
  }

  transition(
    organizationId: string,
    evidenceId: string,
    actorUserId: string,
    to: EvidenceStatus,
    permissions: readonly Permission[],
    opts: { method?: string; note?: string },
    requestId: string,
  ): Promise<{ id: string; status: EvidenceStatus }> {
    return withOrgContext(organizationId, (db) =>
      transitionEvidence(db, {
        organizationId,
        evidenceId,
        to,
        actorUserId,
        permissions,
        method: opts.method,
        note: opts.note,
        requestId,
      }),
    );
  }

  supersede(
    organizationId: string,
    evidenceId: string,
    actorUserId: string,
    body: SupersedeEvidenceBody,
    requestId: string,
  ): Promise<{ id: string; version: number }> {
    return withOrgContext(organizationId, (db) =>
      supersedeEvidence(db, {
        organizationId,
        evidenceId,
        actorUserId,
        requestId,
        overrides: body,
      }),
    );
  }

  async linkDatapoint(
    organizationId: string,
    evidenceId: string,
    datapointId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      await this.assertBelongs(db, organizationId, evidenceId, datapointId);
      await db.datapointEvidence.upsert({
        where: { datapointId_evidenceId: { datapointId, evidenceId } },
        create: { organizationId, datapointId, evidenceId, linkedByUserId: actorUserId },
        update: {},
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'evidence.linked_datapoint',
        resourceType: 'evidence',
        resourceId: evidenceId,
        before: null,
        after: { datapointId },
        requestId,
      });
    });
  }

  async unlinkDatapoint(
    organizationId: string,
    evidenceId: string,
    datapointId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      await db.datapointEvidence.deleteMany({ where: { evidenceId, datapointId, organizationId } });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'evidence.unlinked_datapoint',
        resourceType: 'evidence',
        resourceId: evidenceId,
        before: { datapointId },
        after: null,
        requestId,
      });
    });
  }

  private async assertBelongs(
    db: TenantDb,
    organizationId: string,
    evidenceId: string,
    datapointId: string,
  ): Promise<void> {
    const [ev, dp] = await Promise.all([
      db.evidence.findFirst({ where: { id: evidenceId, organizationId }, select: { id: true } }),
      db.datapoint.findFirst({ where: { id: datapointId, organizationId }, select: { id: true } }),
    ]);
    if (!ev) throw AppError.notFound('evidence.not_found', 'Evidence not found.');
    if (!dp) throw AppError.notFound('datapoint.not_found', 'Datapoint not found.');
  }
}
