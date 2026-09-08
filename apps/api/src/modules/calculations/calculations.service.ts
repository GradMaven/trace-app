import { Injectable } from '@nestjs/common';
import { AppError, page, type Page } from '@trace/shared';
import {
  recomputeCalculation,
  reproduceCalculation,
  runCalculation,
  withOrgContext,
  writeAuditLog,
  type RunCalculationResult,
} from '@trace/db';

export interface CalculationListItem {
  id: string;
  scope: string;
  ghgCategory: string | null;
  methodology: string;
  reportingPeriod: string;
  resultValueTco2e: string;
  calculationVersion: string;
  current: boolean;
  approved: boolean;
  calculatedAt: string;
}

@Injectable()
export class CalculationsService {
  run(
    organizationId: string,
    actorUserId: string,
    input: {
      activityId: string;
      emissionFactorId?: string;
      methodology?: string;
      geography?: string | null;
      assumptions?: Record<string, unknown>;
    },
    requestId: string,
  ): Promise<RunCalculationResult> {
    return withOrgContext(organizationId, (db) =>
      runCalculation(db, {
        organizationId,
        activityId: input.activityId,
        emissionFactorId: input.emissionFactorId,
        methodology: input.methodology as never,
        geography: input.geography ?? null,
        assumptions: input.assumptions,
        actorUserId,
        requestId,
      }),
    );
  }

  recompute(
    organizationId: string,
    actorUserId: string,
    calculationId: string,
    requestId: string,
  ): Promise<RunCalculationResult> {
    return withOrgContext(organizationId, (db) =>
      recomputeCalculation(db, { organizationId, calculationId, actorUserId, requestId }),
    );
  }

  reproduce(organizationId: string, calculationId: string): Promise<unknown> {
    return withOrgContext(organizationId, (db) =>
      reproduceCalculation(db, organizationId, calculationId),
    );
  }

  async list(
    organizationId: string,
    query: { reportingPeriod?: string; scope?: string; limit: number; cursor?: string },
  ): Promise<Page<CalculationListItem>> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.calculation.findMany({
        where: {
          organizationId,
          ...(query.reportingPeriod ? { reportingPeriod: query.reportingPeriod } : {}),
          ...(query.scope ? { scope: query.scope as never } : {}),
        },
        include: { supersededBy: { select: { id: true } } },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((c) => ({
        id: c.id,
        scope: c.scope,
        ghgCategory: c.ghgCategory,
        methodology: c.methodology,
        reportingPeriod: c.reportingPeriod,
        resultValueTco2e: c.resultValueTco2e.toString(),
        calculationVersion: c.calculationVersion,
        current: c.supersededBy.length === 0,
        approved: c.approvedAt !== null,
        calculatedAt: c.calculatedAt.toISOString(),
      }));
      return page(items, hasMore ? items[items.length - 1]!.id : undefined);
    });
  }

  async lineage(organizationId: string, id: string): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const c = await db.calculation.findFirst({
        where: { id, organizationId },
        include: {
          activity: {
            include: {
              evidence: {
                include: {
                  evidence: {
                    select: { id: true, title: true, type: true, status: true, reportingPeriod: true },
                  },
                },
              },
            },
          },
          emissionFactor: true,
          supersedes: { select: { id: true, resultValueTco2e: true } },
          supersededBy: { select: { id: true, resultValueTco2e: true } },
          datapoints: { select: { id: true, metricKey: true } },
        },
      });
      if (!c) throw AppError.notFound('calculation.not_found', 'Calculation not found.');

      return {
        calculation: {
          id: c.id,
          scope: c.scope,
          ghgCategory: c.ghgCategory,
          methodology: c.methodology,
          reportingPeriod: c.reportingPeriod,
          resultValueTco2e: c.resultValueTco2e.toString(),
          calculationVersion: c.calculationVersion,
          calculatedAt: c.calculatedAt.toISOString(),
          approvedAt: c.approvedAt?.toISOString() ?? null,
          approvedByUserId: c.approvedByUserId,
          gwpSet: c.gwpSet,
          inputs: {
            inputValue: c.inputValue.toString(),
            inputUnit: c.inputUnit,
            normalizedValue: c.normalizedValue.toString(),
            normalizedUnit: c.normalizedUnit,
            factorValue: c.factorValue.toString(),
            factorNumeratorUnit: c.factorNumeratorUnit,
            factorDenominatorUnit: c.factorDenominatorUnit,
            factorSource: c.factorSource,
            factorVersion: c.factorVersion,
          },
          steps: c.steps,
          assumptions: c.assumptions,
          factorSelectionReasons: c.factorSelectionReasons,
        },
        activity: {
          id: c.activity.id,
          category: c.activity.category,
          description: c.activity.description,
          value: c.activity.value.toString(),
          unit: c.activity.unit,
          provenance: c.activity.provenance,
          subjectType: c.activity.subjectType,
          subjectId: c.activity.subjectId,
          evidence: c.activity.evidence.map((e) => ({
            id: e.evidence.id,
            title: e.evidence.title,
            type: e.evidence.type,
            status: e.evidence.status,
            reportingPeriod: e.evidence.reportingPeriod,
          })),
        },
        emissionFactor: {
          id: c.emissionFactor.id,
          scopeSet: c.emissionFactor.organizationId ? 'organization' : 'library',
          source: c.emissionFactor.source,
          sourceRef: c.emissionFactor.sourceRef,
          name: c.emissionFactor.name,
          value: c.emissionFactor.value.toString(),
          unit: `${c.emissionFactor.numeratorUnit}/${c.emissionFactor.denominatorUnit}`,
          gwpSet: c.emissionFactor.gwpSet,
          geography: c.emissionFactor.geography,
          methodology: c.emissionFactor.methodology,
          version: c.emissionFactor.version,
          validFrom: c.emissionFactor.validFrom.toISOString().slice(0, 10),
          validTo: c.emissionFactor.validTo?.toISOString().slice(0, 10) ?? null,
          notes: c.emissionFactor.notes,
        },
        versionChain: { supersedes: c.supersedes, supersededBy: c.supersededBy },
        producedDatapoints: c.datapoints,
      };
    });
  }

  async approve(
    organizationId: string,
    id: string,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      const c = await db.calculation.findFirst({ where: { id, organizationId } });
      if (!c) throw AppError.notFound('calculation.not_found', 'Calculation not found.');
      if (c.approvedAt) {
        throw AppError.conflict('calculation.already_approved', 'This calculation is already approved.');
      }
      const superseded = await db.calculation.count({ where: { supersedesId: id } });
      if (superseded > 0) {
        throw AppError.conflict(
          'calculation.superseded',
          'This calculation has been superseded; approve the current version.',
        );
      }
      await db.calculation.update({
        where: { id },
        data: { approvedAt: new Date(), approvedByUserId: actorUserId },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'calculation.approved',
        resourceType: 'calculation',
        resourceId: id,
        before: { approved: false },
        after: { approved: true, resultValueTco2e: c.resultValueTco2e.toString() },
        requestId,
      });
    });
  }
}
