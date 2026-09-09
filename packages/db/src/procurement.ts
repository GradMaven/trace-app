import {
  compareSuppliers,
  projectScenario,
  type ScenarioChange,
  type ScenarioLineInput,
  type ScenarioResult,
  type SupplierComparison,
  type SupplierComparisonInput,
} from '@trace/domain';
import { AppError, type Provenance } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Procurement intelligence (Phase 11). All ranking / intensity / what-if maths
 * live in `@trace/domain` (pure); this module gathers the tenant's suppliers,
 * their attributed Scope 3 emissions, spend, passports and Trust, and persists
 * saved scenarios. `db` must already be a tenant transaction.
 */

function activePeriod(configured: unknown, explicit: string | undefined): string {
  if (explicit) return explicit;
  if (configured && typeof configured === 'object' && 'activePeriod' in configured) {
    const v = (configured as { activePeriod?: unknown }).activePeriod;
    if (typeof v === 'string' && v) return v;
  }
  return `FY${new Date().getFullYear() - 1}`;
}

const PROVENANCE_RANK: Record<Provenance, number> = {
  measured: 6,
  supplier_reported: 5,
  calculated: 4,
  estimated: 3,
  modeled: 2,
  inferred: 1,
};

function bestProvenance(a: Provenance | null, b: Provenance): Provenance {
  if (!a) return b;
  return PROVENANCE_RANK[b] > PROVENANCE_RANK[a] ? b : a;
}

// ---------------------------------------------------------------------------
// Supplier carbon comparison
// ---------------------------------------------------------------------------

export async function supplierCarbonComparison(
  db: TenantDb,
  organizationId: string,
  reportingPeriod?: string,
): Promise<SupplierComparison> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const period = activePeriod(org.reportingPeriodConfig, reportingPeriod);

  const suppliers = await db.supplier.findMany({
    where: { organizationId, status: 'active' },
    include: {
      relationship: { select: { annualSpend: true, category: true, tier: true } },
      passports: { select: { id: true }, take: 1 },
    },
    orderBy: { name: 'asc' },
  });

  const emissionDps = await db.datapoint.findMany({
    where: {
      organizationId,
      subjectType: 'supplier',
      metricKey: { startsWith: 'emission_' },
      reportingPeriod: period,
    },
    select: { subjectId: true, valueNumeric: true, provenance: true, calculationId: true },
  });

  const calcIds = [
    ...new Set(emissionDps.map((d) => d.calculationId).filter((x): x is string => !!x)),
  ];
  const calcs = calcIds.length
    ? await db.calculation.findMany({
        where: { id: { in: calcIds } },
        select: { id: true, methodology: true },
      })
    : [];
  const methodologyByCalc = new Map(calcs.map((c) => [c.id, c.methodology]));

  const trustRows = await db.trustScore.findMany({
    where: {
      organizationId,
      subjectType: 'supplier',
      supersededBy: { none: {} },
      metricKey: { startsWith: 'emission_' },
    },
    select: { subjectId: true, value: true },
  });
  const minTrustBySupplier = new Map<string, number>();
  for (const t of trustRows) {
    const cur = minTrustBySupplier.get(t.subjectId);
    if (cur == null || t.value < cur) minTrustBySupplier.set(t.subjectId, t.value);
  }

  interface Agg {
    emissions: number;
    provenance: Provenance | null;
    methodology: string | null;
  }
  const bySupplier = new Map<string, Agg>();
  for (const d of emissionDps) {
    const agg = bySupplier.get(d.subjectId) ?? {
      emissions: 0,
      provenance: null,
      methodology: null,
    };
    agg.emissions += d.valueNumeric ? Number(d.valueNumeric) : 0;
    agg.provenance = bestProvenance(agg.provenance, d.provenance as Provenance);
    const m = d.calculationId ? (methodologyByCalc.get(d.calculationId) ?? null) : null;
    if (m === 'supplier_specific' || agg.methodology == null)
      agg.methodology = m ?? agg.methodology;
    bySupplier.set(d.subjectId, agg);
  }

  const inputs: SupplierComparisonInput[] = suppliers.map((s) => {
    const agg = bySupplier.get(s.id);
    return {
      supplierId: s.id,
      name: s.name,
      country: s.country,
      category: s.relationship?.category ?? null,
      tier: s.relationship?.tier ?? null,
      annualSpendEur: s.relationship?.annualSpend ? Number(s.relationship.annualSpend) : null,
      emissionsTco2e: agg ? Number(agg.emissions.toFixed(4)) : null,
      provenance: agg?.provenance ?? null,
      methodology: agg?.methodology ?? null,
      trustScore: minTrustBySupplier.get(s.id) ?? null,
      hasPassport: s.passports.length > 0,
    };
  });

  return compareSuppliers(inputs, period);
}

// ---------------------------------------------------------------------------
// Scenario lines from real calculations
// ---------------------------------------------------------------------------

export async function scenarioLinesForSuppliers(
  db: TenantDb,
  organizationId: string,
  supplierIds: string[],
  reportingPeriod?: string,
): Promise<ScenarioLineInput[]> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const period = activePeriod(org.reportingPeriodConfig, reportingPeriod);

  const lines: ScenarioLineInput[] = [];
  for (const supplierId of supplierIds) {
    const [supplier, dp] = await Promise.all([
      db.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { name: true } }),
      db.datapoint.findFirst({
        where: {
          organizationId,
          subjectType: 'supplier',
          subjectId: supplierId,
          metricKey: { startsWith: 'emission_' },
          reportingPeriod: period,
          calculationId: { not: null },
        },
        orderBy: { valueNumeric: 'desc' },
        select: { calculationId: true },
      }),
    ]);
    if (!supplier || !dp?.calculationId) continue;
    const calc = await db.calculation.findUnique({
      where: { id: dp.calculationId },
      include: { activity: { select: { category: true } } },
    });
    if (!calc) continue;
    lines.push({
      supplierId,
      supplierName: supplier.name,
      label: calc.activity?.category ?? calc.scope,
      activityValue: Number(calc.inputValue),
      activityUnit: calc.inputUnit,
      factorValue: Number(calc.factorValue),
      factorNumeratorUnit: calc.factorNumeratorUnit,
      factorDenominatorUnit: calc.factorDenominatorUnit,
      gwpSet: calc.gwpSet,
      methodology: calc.methodology,
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Saved scenarios
// ---------------------------------------------------------------------------

export interface RunProcurementScenarioArgs {
  organizationId: string;
  name: string;
  description?: string;
  reportingPeriod?: string;
  lines: ScenarioLineInput[];
  changes: ScenarioChange[];
  actorUserId: string;
  requestId: string;
}

export interface RunProcurementScenarioResult {
  id: string;
  result: ScenarioResult;
}

export async function runProcurementScenario(
  db: TenantDb,
  args: RunProcurementScenarioArgs,
): Promise<RunProcurementScenarioResult> {
  if (args.lines.length === 0) {
    throw AppError.unprocessable(
      'procurement.no_lines',
      'A scenario needs at least one supplier line.',
    );
  }
  let result: ScenarioResult;
  try {
    result = projectScenario(args.lines, args.changes);
  } catch (err) {
    throw AppError.unprocessable(
      'procurement.scenario_failed',
      err instanceof Error ? err.message : 'Could not project the scenario.',
    );
  }

  const row = await db.procurementScenario.create({
    data: {
      organizationId: args.organizationId,
      name: args.name,
      description: args.description ?? null,
      reportingPeriod: args.reportingPeriod ?? null,
      engineVersion: result.engineVersion,
      baselineTco2e: result.baselineTco2e,
      projectedTco2e: result.projectedTco2e,
      deltaTco2e: result.deltaTco2e,
      deltaPct: result.deltaPct,
      inputs: { lines: args.lines, changes: args.changes } as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
      createdByUserId: args.actorUserId,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'procurement.scenario_run',
    resourceType: 'procurement_scenario',
    resourceId: row.id,
    before: null,
    after: {
      name: args.name,
      baselineTco2e: result.baselineTco2e,
      projectedTco2e: result.projectedTco2e,
      deltaTco2e: result.deltaTco2e,
      lines: args.lines.length,
    },
    requestId: args.requestId,
  });

  return { id: row.id, result };
}

function toView(s: {
  id: string;
  name: string;
  description: string | null;
  reportingPeriod: string | null;
  engineVersion: string;
  baselineTco2e: { toString(): string };
  projectedTco2e: { toString(): string };
  deltaTco2e: { toString(): string };
  deltaPct: { toString(): string };
  inputs: unknown;
  result: unknown;
  createdByUserId: string;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    reportingPeriod: s.reportingPeriod,
    engineVersion: s.engineVersion,
    baselineTco2e: s.baselineTco2e.toString(),
    projectedTco2e: s.projectedTco2e.toString(),
    deltaTco2e: s.deltaTco2e.toString(),
    deltaPct: s.deltaPct.toString(),
    inputs: s.inputs,
    result: s.result,
    createdByUserId: s.createdByUserId,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listProcurementScenarios(
  db: TenantDb,
  organizationId: string,
  limit = 25,
): Promise<Record<string, unknown>[]> {
  const rows = await db.procurementScenario.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toView);
}

export async function procurementScenarioById(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const row = await db.procurementScenario.findFirst({ where: { id, organizationId } });
  if (!row)
    throw AppError.notFound('procurement.scenario_not_found', 'Procurement scenario not found.');
  return toView(row);
}
