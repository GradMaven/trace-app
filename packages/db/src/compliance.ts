import { periodYear } from '@trace/domain';
import {
  evaluateRequiredDatapoint,
  evaluateRuleStore,
  flattenRequiredDatapoints,
  getRuleStore,
  listRuleStoreVersions,
  readinessPct,
  rollUpDisclosureStatus,
  type CandidateDatapoint,
  type RequiredDatapointInput,
  type RuleStore,
} from '@trace/compliance';
import { AppError, type ComplianceStatus } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Compliance operations (Phase 7). The rule store and the mapping engine are
 * pure and live in `@trace/compliance`; this module loads a rule-store version
 * into the global `regulation` … `evidence_requirement` tables, gathers the
 * tenant's company data, runs the engine, and persists `compliance_mapping` /
 * `disclosure_status` / `compliance_run` rows. `db` must already be a tenant
 * transaction. TRACE never records "compliant" — only the objective ladder.
 */

const SATISFIED_STATUSES: ReadonlySet<ComplianceStatus> = new Set([
  'evidence_available',
  'mapping_complete',
]);

export { listRuleStoreVersions };

function isoNow(reportingPeriod: string | null | undefined): string {
  const y = periodYear(reportingPeriod ?? null);
  return y ? `${y}-12-31` : new Date().toISOString().slice(0, 10);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Rule-store loader
// ---------------------------------------------------------------------------

export interface LoadRuleStoreResult {
  version: string;
  regulations: number;
  requirements: number;
  disclosures: number;
  requiredDatapoints: number;
  evidenceRequirements: number;
}

/** Idempotently load a rule-store version into the global rule tables. */
export async function loadRuleStore(db: TenantDb, version: string): Promise<LoadRuleStoreResult> {
  const store = getRuleStore(version);
  const counts = {
    requirements: 0,
    disclosures: 0,
    requiredDatapoints: 0,
    evidenceRequirements: 0,
  };

  const reg = await db.regulation.upsert({
    where: { key_ruleStoreVersion: { key: store.regulation.key, ruleStoreVersion: version } },
    create: {
      key: store.regulation.key,
      name: store.regulation.name,
      jurisdiction: store.regulation.jurisdiction,
      description: store.regulation.description,
      notice: store.notice,
      ruleStoreVersion: version,
    },
    update: {
      name: store.regulation.name,
      jurisdiction: store.regulation.jurisdiction,
      description: store.regulation.description,
      notice: store.notice,
    },
  });

  for (const req of store.regulation.requirements) {
    const reqRow = await db.requirement.upsert({
      where: { regulationId_code: { regulationId: reg.id, code: req.code } },
      create: {
        regulationId: reg.id,
        code: req.code,
        title: req.title,
        description: req.description,
        ruleStoreVersion: version,
      },
      update: { title: req.title, description: req.description },
    });
    counts.requirements += 1;

    for (const dis of req.disclosures) {
      const disRow = await db.disclosure.upsert({
        where: {
          requirementId_code_ruleStoreVersion: {
            requirementId: reqRow.id,
            code: dis.code,
            ruleStoreVersion: version,
          },
        },
        create: {
          requirementId: reqRow.id,
          code: dis.code,
          title: dis.title,
          guidance: dis.guidance,
          ruleStoreVersion: version,
        },
        update: { title: dis.title, guidance: dis.guidance },
      });
      counts.disclosures += 1;

      for (const rd of dis.requiredDatapoints) {
        await db.requiredDatapoint.upsert({
          where: { key_ruleStoreVersion: { key: rd.key, ruleStoreVersion: version } },
          create: {
            disclosureId: disRow.id,
            key: rd.key,
            metricKey: rd.metricKey,
            unit: rd.unit,
            cardinality: rd.cardinality,
            subjectScope: rd.subjectScope,
            aggregation: rd.aggregation ?? 'single',
            minTrustScore: rd.minTrustScore ?? null,
            label: rd.label,
            conditions: (rd.conditions ?? {}) as Prisma.InputJsonValue,
            ruleStoreVersion: version,
          },
          update: {
            disclosureId: disRow.id,
            metricKey: rd.metricKey,
            unit: rd.unit,
            cardinality: rd.cardinality,
            subjectScope: rd.subjectScope,
            aggregation: rd.aggregation ?? 'single',
            minTrustScore: rd.minTrustScore ?? null,
            label: rd.label,
            conditions: (rd.conditions ?? {}) as Prisma.InputJsonValue,
          },
        });
        counts.requiredDatapoints += 1;
      }

      for (const ev of dis.evidenceRequirements) {
        await db.evidenceRequirement.upsert({
          where: {
            disclosureId_key_ruleStoreVersion: {
              disclosureId: disRow.id,
              key: ev.key,
              ruleStoreVersion: version,
            },
          },
          create: {
            disclosureId: disRow.id,
            key: ev.key,
            description: ev.description,
            acceptableTypes: ev.acceptableTypes,
            ruleStoreVersion: version,
          },
          update: { description: ev.description, acceptableTypes: ev.acceptableTypes },
        });
        counts.evidenceRequirements += 1;
      }
    }
  }

  return { version, regulations: 1, ...counts };
}

// ---------------------------------------------------------------------------
// Candidate gathering
// ---------------------------------------------------------------------------

type DatapointForCompliance = Prisma.DatapointGetPayload<{
  include: {
    evidence: { include: { evidence: true } };
    calculation: { include: { emissionFactor: true; activity: true } };
  };
}>;

function toCandidate(dp: DatapointForCompliance, trustScore: number | null): CandidateDatapoint {
  let factorOutdated = false;
  if (dp.calculation?.emissionFactor.validTo) {
    const asOf = dp.calculation.activity?.occurredOn
      ? isoDate(dp.calculation.activity.occurredOn)
      : isoNow(dp.calculation.reportingPeriod);
    factorOutdated = isoDate(dp.calculation.emissionFactor.validTo) < asOf;
  }
  return {
    id: dp.id,
    subjectType: dp.subjectType,
    valueNumeric: dp.valueNumeric != null ? Number(dp.valueNumeric) : null,
    valueText: dp.valueText,
    unit: dp.unit,
    reportingPeriod: dp.reportingPeriod,
    calculationId: dp.calculationId,
    createdAt: dp.createdAt.toISOString(),
    trustScore,
    evidence: dp.evidence.map((link) => ({
      id: link.evidence.id,
      status: link.evidence.status as string,
      expiresAt: link.evidence.expiresAt ? isoDate(link.evidence.expiresAt) : null,
    })),
    factorOutdated,
  };
}

async function gatherInputs(
  db: TenantDb,
  organizationId: string,
  store: RuleStore,
  reportingPeriod: string | undefined,
): Promise<Record<string, RequiredDatapointInput>> {
  const flat = flattenRequiredDatapoints(store);
  const metricKeys = [...new Set(flat.map((f) => f.datapoint.metricKey))];

  const datapoints = (await db.datapoint.findMany({
    where: {
      organizationId,
      metricKey: { in: metricKeys },
      ...(reportingPeriod ? { reportingPeriod } : {}),
    },
    include: {
      evidence: { include: { evidence: true } },
      calculation: { include: { emissionFactor: true, activity: true } },
    },
  })) as DatapointForCompliance[];

  const trustRows = await db.trustScore.findMany({
    where: {
      organizationId,
      datapointId: { in: datapoints.map((d) => d.id) },
      supersededBy: { none: {} },
    },
    select: { datapointId: true, value: true },
  });
  const trustByDp = new Map(trustRows.map((t) => [t.datapointId, t.value]));

  const byMetric = new Map<string, CandidateDatapoint[]>();
  for (const dp of datapoints) {
    const list = byMetric.get(dp.metricKey) ?? [];
    list.push(toCandidate(dp, trustByDp.get(dp.id) ?? null));
    byMetric.set(dp.metricKey, list);
  }

  const existingMappings = await db.complianceMapping.findMany({
    where: { organizationId, ruleStoreVersion: store.version },
    select: { requiredDatapointId: true, confirmed: true },
  });
  const rdRows = await db.requiredDatapoint.findMany({
    where: { ruleStoreVersion: store.version },
    select: { id: true, key: true },
  });
  const rdKeyById = new Map(rdRows.map((r) => [r.id, r.key]));
  const confirmedByKey = new Map<string, boolean>();
  for (const m of existingMappings) {
    const key = rdKeyById.get(m.requiredDatapointId);
    if (key) confirmedByKey.set(key, m.confirmed);
  }

  const inputByKey: Record<string, RequiredDatapointInput> = {};
  for (const f of flat) {
    inputByKey[f.datapoint.key] = {
      candidates: byMetric.get(f.datapoint.metricKey) ?? [],
      confirmed: confirmedByKey.get(f.datapoint.key) ?? false,
    };
  }
  return inputByKey;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface RunComplianceArgs {
  organizationId: string;
  ruleStoreVersion: string;
  reportingPeriod?: string;
  actorUserId?: string;
  requestId: string;
}

export interface RunComplianceResult {
  runId: string;
  ruleStoreVersion: string;
  disclosuresEvaluated: number;
  requiredDatapoints: number;
  mappingsWritten: number;
  readinessPct: number;
  statusCounts: Record<ComplianceStatus, number>;
}

export async function runComplianceEvaluation(
  db: TenantDb,
  args: RunComplianceArgs,
): Promise<RunComplianceResult> {
  const startedAt = Date.now();
  const store = getRuleStore(args.ruleStoreVersion);

  // The rule store must be loaded so we can resolve DB ids.
  const loaded = await db.requiredDatapoint.count({ where: { ruleStoreVersion: store.version } });
  if (loaded === 0) {
    throw AppError.unprocessable(
      'compliance.rule_store_not_loaded',
      `Rule store "${store.version}" is not loaded. Load it before evaluating.`,
    );
  }

  const run = await db.complianceRun.create({
    data: {
      organizationId: args.organizationId,
      ruleStoreVersion: store.version,
      reportingPeriod: args.reportingPeriod ?? null,
      ranByUserId: args.actorUserId ?? null,
    },
  });

  const inputByKey = await gatherInputs(db, args.organizationId, store, args.reportingPeriod);
  const now = isoNow(args.reportingPeriod);
  const evaluation = evaluateRuleStore(store, inputByKey, now);

  const rdRows = await db.requiredDatapoint.findMany({
    where: { ruleStoreVersion: store.version },
    select: { id: true, key: true, disclosureId: true },
  });
  const rdByKey = new Map(rdRows.map((r) => [r.key, r]));

  const disclosureRows = await db.disclosure.findMany({
    where: { ruleStoreVersion: store.version },
    include: { requirement: { select: { code: true } } },
  });
  const disclosureIdByCode = new Map(
    disclosureRows.map((d) => [`${d.requirement.code}::${d.code}`, d.id]),
  );

  const statusCounts: Record<ComplianceStatus, number> = {
    not_started: 0,
    data_available: 0,
    evidence_available: 0,
    mapping_complete: 0,
    review_required: 0,
  };

  let mappingsWritten = 0;
  for (const e of evaluation.requiredDatapoints) {
    const rd = rdByKey.get(e.requiredDatapointKey);
    if (!rd) continue;
    statusCounts[e.status] += 1;
    await db.complianceMapping.upsert({
      where: {
        organizationId_requiredDatapointId_ruleStoreVersion: {
          organizationId: args.organizationId,
          requiredDatapointId: rd.id,
          ruleStoreVersion: store.version,
        },
      },
      create: {
        organizationId: args.organizationId,
        requiredDatapointId: rd.id,
        disclosureId: rd.disclosureId,
        ruleStoreVersion: store.version,
        reportingPeriod: args.reportingPeriod ?? null,
        status: e.status as never,
        gapReasons: e.gapReasons,
        datapointIds: e.datapointIds,
        calculationIds: e.calculationIds,
        evidenceIds: e.evidenceIds,
        resolvedValue: e.value != null ? e.value.toString() : null,
        resolvedValueText: e.valueText,
        trustScore: e.trustScore,
        confirmed: e.confirmed,
      },
      update: {
        disclosureId: rd.disclosureId,
        reportingPeriod: args.reportingPeriod ?? null,
        status: e.status as never,
        gapReasons: e.gapReasons,
        datapointIds: e.datapointIds,
        calculationIds: e.calculationIds,
        evidenceIds: e.evidenceIds,
        resolvedValue: e.value != null ? e.value.toString() : null,
        resolvedValueText: e.valueText,
        trustScore: e.trustScore,
        computedAt: new Date(),
      },
    });
    mappingsWritten += 1;
  }

  for (const d of evaluation.disclosures) {
    const disclosureId = disclosureIdByCode.get(`${d.requirementCode}::${d.disclosureCode}`);
    if (!disclosureId) continue;
    const satisfied = d.requiredDatapoints.filter((r) => SATISFIED_STATUSES.has(r.status)).length;
    await db.disclosureStatusRecord.upsert({
      where: {
        organizationId_disclosureId_ruleStoreVersion: {
          organizationId: args.organizationId,
          disclosureId,
          ruleStoreVersion: store.version,
        },
      },
      create: {
        organizationId: args.organizationId,
        disclosureId,
        ruleStoreVersion: store.version,
        reportingPeriod: args.reportingPeriod ?? null,
        status: d.status as never,
        requiredTotal: d.requiredDatapoints.length,
        satisfied,
        readinessPct: d.readinessPct.toString(),
      },
      update: {
        reportingPeriod: args.reportingPeriod ?? null,
        status: d.status as never,
        requiredTotal: d.requiredDatapoints.length,
        satisfied,
        readinessPct: d.readinessPct.toString(),
        computedAt: new Date(),
      },
    });
  }

  await db.complianceRun.update({
    where: { id: run.id },
    data: {
      disclosuresEvaluated: evaluation.disclosures.length,
      requiredDatapoints: evaluation.requiredDatapoints.length,
      mappingsWritten,
      readinessPct: evaluation.readinessPct.toString(),
      completedAt: new Date(),
      durationMs: Date.now() - startedAt,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId ?? null,
    action: 'compliance.evaluated',
    resourceType: 'compliance_run',
    resourceId: run.id,
    before: null,
    after: {
      ruleStoreVersion: store.version,
      reportingPeriod: args.reportingPeriod ?? null,
      disclosures: evaluation.disclosures.length,
      readinessPct: evaluation.readinessPct,
      statusCounts,
    },
    requestId: args.requestId,
  });

  return {
    runId: run.id,
    ruleStoreVersion: store.version,
    disclosuresEvaluated: evaluation.disclosures.length,
    requiredDatapoints: evaluation.requiredDatapoints.length,
    mappingsWritten,
    readinessPct: evaluation.readinessPct,
    statusCounts,
  };
}

// ---------------------------------------------------------------------------
// Mapping confirmation
// ---------------------------------------------------------------------------

export async function confirmMapping(
  db: TenantDb,
  args: {
    organizationId: string;
    mappingId: string;
    confirm: boolean;
    note?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string; status: string; confirmed: boolean }> {
  const mapping = await db.complianceMapping.findFirst({
    where: { id: args.mappingId, organizationId: args.organizationId },
    include: { requiredDatapoint: true },
  });
  if (!mapping)
    throw AppError.notFound('compliance.mapping_not_found', 'Compliance mapping not found.');

  const store = getRuleStore(mapping.ruleStoreVersion);
  const flat = flattenRequiredDatapoints(store).find(
    (f) => f.datapoint.key === mapping.requiredDatapoint.key,
  );
  if (!flat) {
    throw AppError.unprocessable(
      'compliance.rd_not_in_store',
      'Required datapoint is not in its rule store.',
    );
  }

  const inputs = await gatherInputs(
    db,
    args.organizationId,
    store,
    mapping.reportingPeriod ?? undefined,
  );
  const rdInput = inputs[flat.datapoint.key] ?? { candidates: [], confirmed: false };
  const now = isoNow(mapping.reportingPeriod);
  const re = evaluateRequiredDatapoint(
    flat.datapoint,
    { ...rdInput, confirmed: args.confirm },
    now,
  );

  const updated = await db.complianceMapping.update({
    where: { id: mapping.id },
    data: {
      confirmed: args.confirm,
      confirmedByUserId: args.confirm ? args.actorUserId : null,
      confirmedAt: args.confirm ? new Date() : null,
      note: args.note ?? mapping.note,
      status: re.status as never,
      gapReasons: re.gapReasons,
      datapointIds: re.datapointIds,
      calculationIds: re.calculationIds,
      evidenceIds: re.evidenceIds,
      resolvedValue: re.value != null ? re.value.toString() : null,
      resolvedValueText: re.valueText,
      trustScore: re.trustScore,
      computedAt: new Date(),
    },
  });

  // Recompute the parent disclosure rollup.
  const siblings = await db.complianceMapping.findMany({
    where: {
      organizationId: args.organizationId,
      disclosureId: mapping.disclosureId,
      ruleStoreVersion: mapping.ruleStoreVersion,
    },
    select: { status: true },
  });
  const statuses = siblings.map((s) => s.status as ComplianceStatus);
  await db.disclosureStatusRecord.updateMany({
    where: {
      organizationId: args.organizationId,
      disclosureId: mapping.disclosureId,
      ruleStoreVersion: mapping.ruleStoreVersion,
    },
    data: {
      status: rollUpDisclosureStatus(statuses) as never,
      satisfied: statuses.filter((s) => SATISFIED_STATUSES.has(s)).length,
      readinessPct: readinessPct(statuses).toString(),
      computedAt: new Date(),
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: args.confirm ? 'compliance.mapping_confirmed' : 'compliance.mapping_unconfirmed',
    resourceType: 'compliance_mapping',
    resourceId: mapping.id,
    before: { status: mapping.status, confirmed: mapping.confirmed },
    after: { status: updated.status, confirmed: updated.confirmed },
    requestId: args.requestId,
  });

  return { id: updated.id, status: updated.status, confirmed: updated.confirmed };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export async function upsertControl(
  db: TenantDb,
  args: {
    organizationId: string;
    key: string;
    name: string;
    description?: string;
    requirementCode?: string;
    ruleStoreVersion: string;
    owner?: string;
    status?: string;
    note?: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  let requirementId: string | null = null;
  if (args.requirementCode) {
    const req = await db.requirement.findFirst({
      where: { code: args.requirementCode, ruleStoreVersion: args.ruleStoreVersion },
      select: { id: true },
    });
    requirementId = req?.id ?? null;
  }

  const row = await db.complianceControl.upsert({
    where: { organizationId_key: { organizationId: args.organizationId, key: args.key } },
    create: {
      organizationId: args.organizationId,
      requirementId,
      ruleStoreVersion: args.ruleStoreVersion,
      key: args.key,
      name: args.name,
      description: args.description ?? '',
      owner: args.owner ?? null,
      status: (args.status ?? 'not_implemented') as never,
      note: args.note ?? null,
      lastTestedAt: args.status === 'passed' || args.status === 'failed' ? new Date() : null,
    },
    update: {
      name: args.name,
      description: args.description ?? undefined,
      owner: args.owner ?? undefined,
      status: (args.status ?? undefined) as never,
      note: args.note ?? undefined,
      ...(args.status === 'passed' || args.status === 'failed' ? { lastTestedAt: new Date() } : {}),
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'compliance.control_updated',
    resourceType: 'compliance_control',
    resourceId: row.id,
    before: null,
    after: { key: args.key, status: args.status ?? 'not_implemented' },
    requestId: args.requestId,
  });
  return { id: row.id };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function complianceOverview(
  db: TenantDb,
  organizationId: string,
  ruleStoreVersion: string,
): Promise<unknown> {
  const regulation = await db.regulation.findFirst({
    where: { ruleStoreVersion },
    include: {
      requirements: {
        orderBy: { code: 'asc' },
        include: {
          disclosures: { orderBy: { code: 'asc' }, include: { requiredDatapoints: true } },
        },
      },
    },
  });
  if (!regulation) {
    return { loaded: false, version: ruleStoreVersion, knownVersions: listRuleStoreVersions() };
  }

  const [statusRows, run] = await Promise.all([
    db.disclosureStatusRecord.findMany({ where: { organizationId, ruleStoreVersion } }),
    db.complianceRun.findFirst({
      where: { organizationId, ruleStoreVersion },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  const statusByDisclosure = new Map(statusRows.map((s) => [s.disclosureId, s]));

  const requirements = regulation.requirements.map((req) => ({
    code: req.code,
    title: req.title,
    description: req.description,
    disclosures: req.disclosures.map((dis) => {
      const st = statusByDisclosure.get(dis.id);
      return {
        id: dis.id,
        code: dis.code,
        title: dis.title,
        requiredDatapointCount: dis.requiredDatapoints.length,
        status: st?.status ?? 'not_started',
        satisfied: st?.satisfied ?? 0,
        readinessPct: st ? Number(st.readinessPct) : 0,
      };
    }),
  }));

  const allStatuses = statusRows.map((s) => s.status as ComplianceStatus);
  return {
    loaded: true,
    version: ruleStoreVersion,
    regulation: {
      key: regulation.key,
      name: regulation.name,
      jurisdiction: regulation.jurisdiction,
      notice: regulation.notice,
    },
    requirements,
    readinessPct: run ? Number(run.readinessPct) : readinessPct(allStatuses),
    lastRun: run
      ? {
          id: run.id,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt ? run.completedAt.toISOString() : null,
          reportingPeriod: run.reportingPeriod,
        }
      : null,
  };
}

export async function disclosureDetail(
  db: TenantDb,
  organizationId: string,
  disclosureId: string,
): Promise<unknown> {
  const disclosure = await db.disclosure.findUnique({
    where: { id: disclosureId },
    include: {
      requirement: { include: { regulation: true } },
      requiredDatapoints: true,
      evidenceRequirements: true,
    },
  });
  if (!disclosure)
    throw AppError.notFound('compliance.disclosure_not_found', 'Disclosure not found.');

  const [mappings, statusRow, controls] = await Promise.all([
    db.complianceMapping.findMany({
      where: { organizationId, disclosureId, ruleStoreVersion: disclosure.ruleStoreVersion },
    }),
    db.disclosureStatusRecord.findFirst({
      where: { organizationId, disclosureId, ruleStoreVersion: disclosure.ruleStoreVersion },
    }),
    db.complianceControl.findMany({
      where: { organizationId, ruleStoreVersion: disclosure.ruleStoreVersion },
    }),
  ]);
  const mappingByRd = new Map(mappings.map((m) => [m.requiredDatapointId, m]));

  return {
    id: disclosure.id,
    code: disclosure.code,
    title: disclosure.title,
    guidance: disclosure.guidance,
    ruleStoreVersion: disclosure.ruleStoreVersion,
    notice: disclosure.requirement.regulation.notice,
    requirement: { code: disclosure.requirement.code, title: disclosure.requirement.title },
    status: statusRow?.status ?? 'not_started',
    readinessPct: statusRow ? Number(statusRow.readinessPct) : 0,
    requiredDatapoints: disclosure.requiredDatapoints.map((rd) => {
      const m = mappingByRd.get(rd.id);
      return {
        key: rd.key,
        label: rd.label,
        metricKey: rd.metricKey,
        unit: rd.unit,
        cardinality: rd.cardinality,
        subjectScope: rd.subjectScope,
        mapping: m
          ? {
              id: m.id,
              status: m.status,
              gapReasons: m.gapReasons,
              datapointIds: m.datapointIds,
              calculationIds: m.calculationIds,
              evidenceIds: m.evidenceIds,
              resolvedValue: m.resolvedValue ? m.resolvedValue.toString() : null,
              resolvedValueText: m.resolvedValueText,
              trustScore: m.trustScore,
              confirmed: m.confirmed,
              confirmedAt: m.confirmedAt ? m.confirmedAt.toISOString() : null,
              note: m.note,
            }
          : { status: 'not_started', gapReasons: ['missing_data'], confirmed: false },
      };
    }),
    evidenceRequirements: disclosure.evidenceRequirements.map((e) => ({
      key: e.key,
      description: e.description,
      acceptableTypes: e.acceptableTypes,
    })),
    controls: controls.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      status: c.status,
      owner: c.owner,
      lastTestedAt: c.lastTestedAt ? c.lastTestedAt.toISOString() : null,
    })),
  };
}

export async function complianceGaps(
  db: TenantDb,
  organizationId: string,
  ruleStoreVersion: string,
): Promise<unknown[]> {
  const mappings = await db.complianceMapping.findMany({
    where: {
      organizationId,
      ruleStoreVersion,
      status: { in: ['not_started', 'data_available', 'review_required'] },
    },
    include: {
      requiredDatapoint: true,
      disclosure: { include: { requirement: { select: { code: true, title: true } } } },
    },
    orderBy: [{ status: 'asc' }],
  });
  return mappings.map((m) => ({
    mappingId: m.id,
    status: m.status,
    gapReasons: m.gapReasons,
    requiredDatapoint: {
      key: m.requiredDatapoint.key,
      label: m.requiredDatapoint.label,
      metricKey: m.requiredDatapoint.metricKey,
    },
    disclosure: { id: m.disclosureId, code: m.disclosure.code, title: m.disclosure.title },
    requirement: { code: m.disclosure.requirement.code, title: m.disclosure.requirement.title },
    datapointIds: m.datapointIds,
  }));
}
