import { complianceGaps } from './compliance';
import { inventorySummary } from './carbon';
import { qualitySummary } from './trust';
import { type TenantDb } from './client';

/**
 * Command Center (Phase 9) — a read-only aggregate for the executive dashboard.
 * It composes what Phases 3–8 already produce (emissions, provenance mix, Trust,
 * audit readiness, compliance progress, supplier coverage) into one payload.
 * No fabricated metrics: every number here is read straight from a model row or
 * an existing engine. No writes, no audit log.
 */

const DEFAULT_RULE_STORE_VERSION = 'esrs@2026.1';

function activePeriod(configured: unknown, explicit: string | undefined): string {
  if (explicit) return explicit;
  if (configured && typeof configured === 'object' && 'activePeriod' in configured) {
    const v = (configured as { activePeriod?: unknown }).activePeriod;
    if (typeof v === 'string' && v) return v;
  }
  return `FY${new Date().getFullYear() - 1}`;
}

export interface CommandCenterOverview {
  organization: { id: string; legalName: string; country: string; baseCurrency: string };
  reportingPeriod: string;
  ruleStoreVersion: string;
  emissions: {
    scope1: string;
    scope2Reported: string;
    scope2LocationBased: string;
    scope2MarketBased: string;
    scope3: string;
    total: string;
    byScope3Category: Array<{ ghgCategory: string | null; valueTco2e: string; count: number }>;
  };
  emissionsTrend: Array<{
    reportingPeriod: string;
    total: string;
    scope1: string;
    scope2Reported: string;
    scope3: string;
  }>;
  provenance: {
    total: number;
    byProvenance: Array<{ provenance: string; count: number }>;
    byLabel: Array<{ label: string; count: number }>;
    primarySharePct: number;
  };
  trust: {
    scored: number;
    datapoints: number;
    avgTrustScore: number | null;
    bands: { high: number; medium: number; low: number };
    openIssues: { critical: number; warning: number; info: number; total: number };
    openAnomalies: number;
    lastScanAt: string | null;
  };
  audit: {
    readinessValue: number | null;
    readinessBand: string | null;
    modelVersion: string | null;
    breakdown: unknown;
    openFindings: { critical: number; warning: number; info: number; total: number };
    lastSimulationAt: string | null;
    topFindings: Array<{
      id: string;
      severity: string;
      kind: string | null;
      title: string;
      subjectType: string;
      subjectId: string;
    }>;
  };
  compliance: {
    ruleStoreLoaded: boolean;
    readinessPct: number;
    disclosures: { total: number; byStatus: Record<string, number> };
    lastEvaluatedAt: string | null;
    topGaps: Array<{
      disclosureId: string;
      disclosureCode: string;
      requiredDatapointKey: string;
      label: string;
      status: string;
      gapReasons: string[];
    }>;
  };
  suppliers: {
    active: number;
    withPassport: number;
    withSubmittedQuestionnaire: number;
    coveragePct: number;
  };
  recentActivity: Array<{ id: string; action: string; actorId: string | null; createdAt: string }>;
}

export async function commandCenterOverview(
  db: TenantDb,
  organizationId: string,
  reportingPeriod?: string,
  ruleStoreVersion: string = DEFAULT_RULE_STORE_VERSION,
): Promise<CommandCenterOverview> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const period = activePeriod(org.reportingPeriodConfig, reportingPeriod);

  // --- emissions (current period) --------------------------------------
  const inv = await inventorySummary(db, organizationId, period);
  const byScope3Category = inv.byCategory
    .filter((c) => c.scope === 'scope_3')
    .map((c) => ({ ghgCategory: c.ghgCategory, valueTco2e: c.valueTco2e, count: c.count }));

  // --- emissions trend (all periods with calculations) ------------------
  const periodRows = await db.calculation.groupBy({
    by: ['reportingPeriod'],
    where: { organizationId, supersededBy: { none: {} } },
  });
  const periods = periodRows.map((r) => r.reportingPeriod).sort();
  const emissionsTrend = [];
  for (const p of periods) {
    const s = p === period ? inv : await inventorySummary(db, organizationId, p);
    emissionsTrend.push({
      reportingPeriod: p,
      total: s.total,
      scope1: s.scope1,
      scope2Reported: s.scope2Reported,
      scope3: s.scope3,
    });
  }

  // --- provenance mix (current period) --------------------------------
  const [byProvenanceRows, byLabelRows] = await Promise.all([
    db.datapoint.groupBy({
      by: ['provenance'],
      where: { organizationId, reportingPeriod: period },
      _count: { _all: true },
    }),
    db.datapoint.groupBy({
      by: ['label'],
      where: { organizationId, reportingPeriod: period },
      _count: { _all: true },
    }),
  ]);
  const byProvenance = byProvenanceRows.map((r) => ({
    provenance: r.provenance,
    count: r._count._all,
  }));
  const byLabel = byLabelRows.map((r) => ({ label: r.label, count: r._count._all }));
  const provenanceTotal = byProvenance.reduce((a, r) => a + r.count, 0);
  const primaryCount = byProvenance
    .filter((r) => r.provenance === 'measured' || r.provenance === 'supplier_reported')
    .reduce((a, r) => a + r.count, 0);
  const primarySharePct =
    provenanceTotal === 0 ? 0 : Math.round((primaryCount / provenanceTotal) * 1000) / 10;

  // --- trust --------------------------------------------------------
  const quality = await qualitySummary(db, organizationId, period);

  // --- audit ------------------------------------------------------
  const [latestSim, findingRows, topFindings] = await Promise.all([
    db.auditSimulationRun.findFirst({ where: { organizationId }, orderBy: { startedAt: 'desc' } }),
    db.auditFinding.groupBy({
      by: ['severity'],
      where: { organizationId, status: { in: ['open', 'acknowledged', 'remediating'] } },
      _count: { _all: true },
    }),
    db.auditFinding.findMany({
      where: { organizationId, status: { in: ['open', 'acknowledged', 'remediating'] } },
      orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
      take: 6,
      select: {
        id: true,
        severity: true,
        kind: true,
        title: true,
        subjectType: true,
        subjectId: true,
      },
    }),
  ]);
  const openFindings = { critical: 0, warning: 0, info: 0, total: 0 };
  for (const r of findingRows) {
    openFindings[r.severity as keyof Omit<typeof openFindings, 'total'>] = r._count._all;
    openFindings.total += r._count._all;
  }

  // --- compliance -----------------------------------------------------
  const [regulation, disclosureStatuses, lastRun] = await Promise.all([
    db.regulation.findFirst({ where: { ruleStoreVersion }, select: { id: true } }),
    db.disclosureStatusRecord.findMany({ where: { organizationId, ruleStoreVersion } }),
    db.complianceRun.findFirst({
      where: { organizationId, ruleStoreVersion },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  const byStatus: Record<string, number> = {};
  for (const s of disclosureStatuses) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const rawGaps = disclosureStatuses.length
    ? ((await complianceGaps(db, organizationId, ruleStoreVersion)) as Array<{
        status: string;
        gapReasons: string[];
        requiredDatapoint: { key: string; label: string };
        disclosure: { id: string; code: string };
      }>)
    : [];
  const topGaps = rawGaps.slice(0, 6).map((g) => ({
    disclosureId: g.disclosure.id,
    disclosureCode: g.disclosure.code,
    requiredDatapointKey: g.requiredDatapoint.key,
    label: g.requiredDatapoint.label,
    status: g.status,
    gapReasons: g.gapReasons,
  }));

  // --- suppliers ----------------------------------------------------
  const [activeSuppliers, passportSupplierIds, submittedRequests] = await Promise.all([
    db.supplier.count({ where: { organizationId, status: 'active' } }),
    db.supplierPassport.findMany({
      where: { organizationId },
      select: { supplierId: true },
      distinct: ['supplierId'],
    }),
    db.supplierRequest.findMany({
      where: { organizationId, status: { in: ['submitted', 'accepted'] } },
      select: { supplierId: true },
      distinct: ['supplierId'],
    }),
  ]);
  const withPassport = passportSupplierIds.length;
  const coveragePct =
    activeSuppliers === 0 ? 0 : Math.round((withPassport / activeSuppliers) * 1000) / 10;

  // --- recent activity --------------------------------------------------
  const recent = await db.auditLog.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 8,
    select: { id: true, action: true, actorId: true, createdAt: true },
  });

  return {
    organization: {
      id: org.id,
      legalName: org.legalName,
      country: org.country,
      baseCurrency: org.baseCurrency,
    },
    reportingPeriod: period,
    ruleStoreVersion,
    emissions: {
      scope1: inv.scope1,
      scope2Reported: inv.scope2Reported,
      scope2LocationBased: inv.scope2LocationBased,
      scope2MarketBased: inv.scope2MarketBased,
      scope3: inv.scope3,
      total: inv.total,
      byScope3Category,
    },
    emissionsTrend,
    provenance: { total: provenanceTotal, byProvenance, byLabel, primarySharePct },
    trust: {
      scored: quality.scored,
      datapoints: quality.datapoints,
      avgTrustScore: quality.avgTrustScore,
      bands: quality.bands,
      openIssues: quality.openIssues,
      openAnomalies: quality.openAnomalies,
      lastScanAt: quality.lastScan ? quality.lastScan.startedAt : null,
    },
    audit: {
      readinessValue: latestSim?.readinessValue ?? null,
      readinessBand: latestSim?.readinessBand ?? null,
      modelVersion: latestSim?.modelVersion ?? null,
      breakdown: latestSim?.breakdown ?? null,
      openFindings,
      lastSimulationAt: latestSim ? latestSim.startedAt.toISOString() : null,
      topFindings: topFindings.map((f) => ({
        id: f.id,
        severity: f.severity,
        kind: f.kind,
        title: f.title,
        subjectType: f.subjectType,
        subjectId: f.subjectId,
      })),
    },
    compliance: {
      ruleStoreLoaded: regulation != null,
      readinessPct: lastRun ? Number(lastRun.readinessPct) : 0,
      disclosures: { total: disclosureStatuses.length, byStatus },
      lastEvaluatedAt: lastRun ? lastRun.startedAt.toISOString() : null,
      topGaps,
    },
    suppliers: {
      active: activeSuppliers,
      withPassport,
      withSubmittedQuestionnaire: submittedRequests.length,
      coveragePct,
    },
    recentActivity: recent.map((e) => ({
      id: e.id,
      action: e.action,
      actorId: e.actorId,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}
