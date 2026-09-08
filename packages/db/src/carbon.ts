import {
  aggregateEmissions,
  computeEmission,
  recompute as recomputeEngine,
  selectEmissionFactor,
  summariseInventory,
  unitDimension,
  type FactorCandidate,
} from '@trace/domain';
import { AppError, type GhgCategory, type Methodology } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Carbon-engine operations shared by the API and the Phase 5 AI worker. All
 * arithmetic lives in @trace/domain (pure); this module fetches inputs, persists
 * the immutable Calculation row, produces the emission Datapoint, and rolls up
 * Emission projections. `db` must already be a tenant transaction.
 */

function toCandidate(f: {
  id: string;
  organizationId: string | null;
  source: string;
  sourceRef: string;
  version: number;
  numeratorUnit: string;
  denominatorUnit: string;
  gwpSet: string;
  scope: string;
  ghgCategory: string | null;
  geography: string | null;
  methodology: string | null;
  validFrom: Date;
  validTo: Date | null;
}): FactorCandidate {
  return {
    id: f.id,
    organizationId: f.organizationId,
    source: f.source,
    sourceRef: f.sourceRef,
    version: f.version,
    numeratorUnit: f.numeratorUnit,
    denominatorUnit: f.denominatorUnit,
    gwpSet: f.gwpSet,
    scope: f.scope,
    ghgCategory: f.ghgCategory,
    geography: f.geography,
    methodology: f.methodology,
    validFrom: f.validFrom.toISOString().slice(0, 10),
    validTo: f.validTo ? f.validTo.toISOString().slice(0, 10) : null,
  };
}

export interface RunCalculationArgs {
  organizationId: string;
  activityId: string;
  emissionFactorId?: string;
  methodology?: Methodology;
  geography?: string | null;
  assumptions?: Record<string, unknown>;
  actorUserId: string;
  requestId: string;
}

export interface RunCalculationResult {
  calculationId: string;
  datapointId: string;
  resultValueTco2e: string;
  factorId: string;
  factorSelectionReasons: string[];
}

async function selectFactorFor(
  db: TenantDb,
  organizationId: string,
  activity: {
    scope: string;
    ghgCategory: string | null;
    unit: string;
    reportingPeriod: string;
    occurredOn: Date | null;
  },
  opts: { methodology?: Methodology; geography?: string | null },
): Promise<{ factor: FactorCandidate; reasons: string[] }> {
  const rows = await db.emissionFactor.findMany({
    where: {
      scope: activity.scope as never,
      OR: [{ organizationId }, { organizationId: null }],
    },
  });
  const asOf = (activity.occurredOn ?? new Date()).toISOString().slice(0, 10);
  const selection = selectEmissionFactor(rows.map(toCandidate), {
    activityUnit: activity.unit,
    scope: activity.scope,
    ghgCategory: activity.ghgCategory,
    geography: opts.geography ?? null,
    asOf,
    methodologyPreference: opts.methodology ?? null,
  });
  if (!selection) {
    throw AppError.unprocessable(
      'calculation.no_factor',
      `No emission factor matches this activity (scope ${activity.scope}, unit ${activity.unit}).`,
    );
  }
  return selection;
}

export async function runCalculation(
  db: TenantDb,
  args: RunCalculationArgs,
): Promise<RunCalculationResult> {
  const activity = await db.activityData.findFirst({
    where: { id: args.activityId, organizationId: args.organizationId, deletedAt: null },
    include: { evidence: { select: { evidenceId: true } } },
  });
  if (!activity) throw AppError.notFound('activity.not_found', 'Activity data not found.');

  let factorRow;
  let reasons: string[];
  if (args.emissionFactorId) {
    factorRow = await db.emissionFactor.findFirst({
      where: {
        id: args.emissionFactorId,
        OR: [{ organizationId: args.organizationId }, { organizationId: null }],
      },
    });
    if (!factorRow) {
      throw AppError.unprocessable('calculation.factor_not_found', 'Emission factor not found.');
    }
    if (unitDimension(factorRow.denominatorUnit) !== unitDimension(activity.unit)) {
      throw AppError.unprocessable(
        'calculation.unit_incompatible',
        `Activity unit "${activity.unit}" is incompatible with factor unit "${factorRow.denominatorUnit}".`,
      );
    }
    reasons = ['factor chosen explicitly by the user'];
  } else {
    const selection = await selectFactorFor(
      db,
      args.organizationId,
      {
        scope: activity.scope,
        ghgCategory: activity.ghgCategory,
        unit: activity.unit,
        reportingPeriod: activity.reportingPeriod,
        occurredOn: activity.occurredOn,
      },
      { methodology: args.methodology, geography: args.geography },
    );
    factorRow = await db.emissionFactor.findUniqueOrThrow({ where: { id: selection.factor.id } });
    reasons = selection.reasons;
  }

  const methodology: Methodology =
    args.methodology ?? (factorRow.methodology as Methodology | null) ?? 'average_data';

  const computed = computeEmission({
    activityValue: activity.value.toString(),
    activityUnit: activity.unit,
    factorValue: factorRow.value.toString(),
    factorNumeratorUnit: factorRow.numeratorUnit,
    factorDenominatorUnit: factorRow.denominatorUnit,
    gwpSet: factorRow.gwpSet,
    methodology,
    assumptions: args.assumptions,
  });

  const calc = await db.calculation.create({
    data: {
      organizationId: args.organizationId,
      activityId: activity.id,
      emissionFactorId: factorRow.id,
      methodology: methodology as never,
      inputValue: computed.inputValue,
      inputUnit: computed.inputUnit,
      normalizedValue: computed.normalizedValue,
      normalizedUnit: computed.normalizedUnit,
      factorValue: computed.factorValue,
      factorNumeratorUnit: computed.factorNumeratorUnit as never,
      factorDenominatorUnit: computed.factorDenominatorUnit,
      factorSource: `${factorRow.source}:${factorRow.sourceRef}`,
      factorVersion: factorRow.version,
      gwpSet: computed.gwpSet,
      scope: activity.scope,
      ghgCategory: activity.ghgCategory,
      reportingPeriod: activity.reportingPeriod,
      resultValueTco2e: computed.resultValueTco2e,
      assumptions: computed.assumptions as Prisma.InputJsonValue,
      steps: computed.steps as Prisma.InputJsonValue,
      factorSelectionReasons: reasons as Prisma.InputJsonValue,
      calculationVersion: computed.calculationVersion,
      calculatedByUserId: args.actorUserId,
    },
  });

  const metricKey = activity.ghgCategory
    ? `emission_${activity.ghgCategory}_tco2e`
    : `emission_${activity.scope}_tco2e`;

  const datapoint = await db.datapoint.create({
    data: {
      organizationId: args.organizationId,
      metricKey,
      valueNumeric: computed.resultValueTco2e,
      unit: 'tCO2e',
      provenance: 'calculated',
      label: 'human_reviewed',
      reportingPeriod: activity.reportingPeriod,
      subjectType: activity.subjectType,
      subjectId: activity.subjectId,
      calculationId: calc.id,
      createdByUserId: args.actorUserId,
    },
  });

  // Inherit the activity's evidence links onto the produced datapoint.
  if (activity.evidence.length > 0) {
    await db.datapointEvidence.createMany({
      data: activity.evidence.map((e) => ({
        organizationId: args.organizationId,
        datapointId: datapoint.id,
        evidenceId: e.evidenceId,
        linkedByUserId: args.actorUserId,
      })),
      skipDuplicates: true,
    });
  }

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'calculation.run',
    resourceType: 'calculation',
    resourceId: calc.id,
    before: null,
    after: {
      activityId: activity.id,
      emissionFactorId: factorRow.id,
      methodology,
      resultValueTco2e: computed.resultValueTco2e,
    },
    requestId: args.requestId,
  });

  return {
    calculationId: calc.id,
    datapointId: datapoint.id,
    resultValueTco2e: computed.resultValueTco2e,
    factorId: factorRow.id,
    factorSelectionReasons: reasons,
  };
}

/** Read-only: re-run the engine on the stored inputs and confirm reproducibility. */
export async function reproduceCalculation(
  db: TenantDb,
  organizationId: string,
  calculationId: string,
): Promise<{ reproduced: boolean; storedResult: string; recomputedResult: string; steps: string[] }> {
  const c = await db.calculation.findFirst({ where: { id: calculationId, organizationId } });
  if (!c) throw AppError.notFound('calculation.not_found', 'Calculation not found.');
  const { reproduced, result } = recomputeEngine({
    activityValue: c.inputValue.toString(),
    activityUnit: c.inputUnit,
    factorValue: c.factorValue.toString(),
    factorNumeratorUnit: c.factorNumeratorUnit,
    factorDenominatorUnit: c.factorDenominatorUnit,
    gwpSet: c.gwpSet,
    methodology: c.methodology,
    resultValueTco2e: c.resultValueTco2e.toString(),
  });
  return {
    reproduced,
    storedResult: c.resultValueTco2e.toString(),
    recomputedResult: result.resultValueTco2e,
    steps: result.steps,
  };
}

/** Re-select the factor + re-run for an activity; freezes the old calc, chains a new one. */
export async function recomputeCalculation(
  db: TenantDb,
  args: { organizationId: string; calculationId: string; actorUserId: string; requestId: string },
): Promise<RunCalculationResult> {
  const old = await db.calculation.findFirst({
    where: { id: args.calculationId, organizationId: args.organizationId },
  });
  if (!old) throw AppError.notFound('calculation.not_found', 'Calculation not found.');

  const fresh = await runCalculation(db, {
    organizationId: args.organizationId,
    activityId: old.activityId,
    methodology: old.methodology as Methodology,
    actorUserId: args.actorUserId,
    requestId: args.requestId,
  });

  await db.calculation.update({
    where: { id: fresh.calculationId },
    data: { supersedesId: old.id },
  });
  await db.datapoint.updateMany({
    where: { calculationId: old.id },
    data: { calculationId: fresh.calculationId },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'calculation.recomputed',
    resourceType: 'calculation',
    resourceId: old.id,
    before: { resultValueTco2e: old.resultValueTco2e.toString() },
    after: { supersededBy: fresh.calculationId, resultValueTco2e: fresh.resultValueTco2e },
    requestId: args.requestId,
  });

  return fresh;
}

export async function recomputeEmissions(
  db: TenantDb,
  args: { organizationId: string; reportingPeriod: string; actorUserId: string; requestId: string },
): Promise<{ groups: number; total: string }> {
  const calcs = await db.calculation.findMany({
    where: {
      organizationId: args.organizationId,
      reportingPeriod: args.reportingPeriod,
      supersededBy: { none: {} },
    },
    select: {
      id: true,
      scope: true,
      ghgCategory: true,
      reportingPeriod: true,
      resultValueTco2e: true,
      methodology: true,
    },
  });

  const totals = aggregateEmissions(
    calcs.map((c) => ({
      scope: c.scope,
      ghgCategory: c.ghgCategory,
      reportingPeriod: c.reportingPeriod,
      resultValueTco2e: c.resultValueTco2e.toString(),
    })),
  );

  // Replace this period's rollup rows.
  await db.emission.deleteMany({
    where: { organizationId: args.organizationId, reportingPeriod: args.reportingPeriod },
  });

  for (const t of totals) {
    const contributing = calcs.filter(
      (c) => c.scope === t.scope && (c.ghgCategory ?? null) === (t.ghgCategory ?? null),
    );
    const methods = [...new Set(contributing.map((c) => c.methodology))].join(', ');
    await db.emission.create({
      data: {
        organizationId: args.organizationId,
        scope: t.scope as never,
        ghgCategory: (t.ghgCategory as GhgCategory | null) ?? null,
        reportingPeriod: t.reportingPeriod,
        valueTco2e: t.valueTco2e,
        calculationCount: t.calculationCount,
        methodSummary: methods || 'n/a',
        sourceCalculationIds: contributing.map((c) => c.id),
      },
    });
  }

  const summary = summariseInventory(
    args.reportingPeriod,
    calcs.map((c) => ({
      scope: c.scope,
      ghgCategory: c.ghgCategory,
      reportingPeriod: c.reportingPeriod,
      resultValueTco2e: c.resultValueTco2e.toString(),
    })),
  );

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'emissions.recomputed',
    resourceType: 'emission',
    resourceId: null,
    before: null,
    after: { reportingPeriod: args.reportingPeriod, groups: totals.length, total: summary.total },
    requestId: args.requestId,
  });

  return { groups: totals.length, total: summary.total };
}

export async function inventorySummary(
  db: TenantDb,
  organizationId: string,
  reportingPeriod: string,
): Promise<ReturnType<typeof summariseInventory>> {
  const calcs = await db.calculation.findMany({
    where: { organizationId, reportingPeriod, supersededBy: { none: {} } },
    select: { scope: true, ghgCategory: true, reportingPeriod: true, resultValueTco2e: true },
  });
  return summariseInventory(
    reportingPeriod,
    calcs.map((c) => ({
      scope: c.scope,
      ghgCategory: c.ghgCategory,
      reportingPeriod: c.reportingPeriod,
      resultValueTco2e: c.resultValueTco2e.toString(),
    })),
  );
}
