import {
  buildCarbonGraph,
  rankHotspots,
  tracePath,
  type CarbonEdgeInput,
  type CarbonGraph,
  type CarbonNodeInput,
  type HotspotReport,
  type NodeAttribution,
} from '@trace/domain';
import { AppError, type Provenance } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Carbon Twin — supply-chain carbon graph (Phase 14). All graph maths live in
 * `@trace/domain/network/graph` (pure). This module gathers the tenant's
 * suppliers, their attributed Scope 3 emissions, spend, evidence and Trust, plus
 * the tenant-declared upstream links, feeds them to the builder, and persists an
 * immutable versioned snapshot. `db` must already be a tenant transaction.
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

// ---------------------------------------------------------------------------
// Declared upstream links (tenant CRUD)
// ---------------------------------------------------------------------------

export interface SupplyChainEdgeView {
  id: string;
  fromSupplierId: string;
  fromSupplierName: string;
  toSupplierId: string | null;
  toLabel: string;
  relationship: string | null;
  tier: number | null;
  source: string;
  createdAt: string;
}

export async function listSupplyChainEdges(
  db: TenantDb,
  organizationId: string,
): Promise<SupplyChainEdgeView[]> {
  const rows = await db.supplyChainEdge.findMany({
    where: { organizationId },
    include: { fromSupplier: { select: { name: true } } },
    orderBy: [{ fromSupplierId: 'asc' }, { toLabel: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    fromSupplierId: r.fromSupplierId,
    fromSupplierName: r.fromSupplier.name,
    toSupplierId: r.toSupplierId,
    toLabel: r.toLabel,
    relationship: r.relationship,
    tier: r.tier,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function upsertSupplyChainEdge(
  db: TenantDb,
  args: {
    organizationId: string;
    fromSupplierId: string;
    toSupplierId?: string | null;
    toLabel?: string | null;
    relationship?: string | null;
    tier?: number | null;
    actorUserId: string;
    requestId: string;
  },
): Promise<{ id: string }> {
  const from = await db.supplier.findFirst({
    where: { id: args.fromSupplierId, organizationId: args.organizationId },
    select: { id: true, relationship: { select: { tier: true } } },
  });
  if (!from) throw AppError.notFound('network.supplier_not_found', 'The buyer supplier was not found.');

  let toLabel = args.toLabel?.trim() ?? '';
  let toSupplierId: string | null = null;
  if (args.toSupplierId) {
    const to = await db.supplier.findFirst({
      where: { id: args.toSupplierId, organizationId: args.organizationId },
      select: { id: true, name: true },
    });
    if (!to) {
      throw AppError.notFound('network.supplier_not_found', 'The upstream supplier was not found.');
    }
    if (to.id === from.id) {
      throw AppError.unprocessable('network.self_edge', 'A supplier cannot supply itself.');
    }
    toSupplierId = to.id;
    if (!toLabel) toLabel = to.name;
  }
  if (!toLabel) {
    throw AppError.unprocessable(
      'network.missing_target',
      'Provide an upstream supplier or a label for the upstream party.',
    );
  }

  const existing = await db.supplyChainEdge.findUnique({
    where: {
      organizationId_fromSupplierId_toLabel: {
        organizationId: args.organizationId,
        fromSupplierId: from.id,
        toLabel,
      },
    },
  });
  const data = {
    toSupplierId,
    relationship: args.relationship?.trim() || null,
    tier: args.tier ?? (from.relationship?.tier != null ? from.relationship.tier + 1 : null),
    source: 'manual',
  };
  const row = existing
    ? await db.supplyChainEdge.update({ where: { id: existing.id }, data })
    : await db.supplyChainEdge.create({
        data: {
          organizationId: args.organizationId,
          fromSupplierId: from.id,
          toLabel,
          createdByUserId: args.actorUserId,
          ...data,
        },
      });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: existing ? 'network.edge_updated' : 'network.edge_added',
    resourceType: 'supply_chain_edge',
    resourceId: row.id,
    before: existing ? { toLabel: existing.toLabel } : null,
    after: { fromSupplierId: from.id, toLabel, toSupplierId },
    requestId: args.requestId,
  });
  return { id: row.id };
}

export async function deleteSupplyChainEdge(
  db: TenantDb,
  args: { organizationId: string; id: string; actorUserId: string; requestId: string },
): Promise<void> {
  const row = await db.supplyChainEdge.findFirst({
    where: { id: args.id, organizationId: args.organizationId },
  });
  if (!row) throw AppError.notFound('network.edge_not_found', 'Supply-chain edge not found.');
  await db.supplyChainEdge.delete({ where: { id: row.id } });
  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'network.edge_removed',
    resourceType: 'supply_chain_edge',
    resourceId: row.id,
    before: { fromSupplierId: row.fromSupplierId, toLabel: row.toLabel },
    after: null,
    requestId: args.requestId,
  });
}

// ---------------------------------------------------------------------------
// Compute + read the graph
// ---------------------------------------------------------------------------

export interface CarbonGraphSnapshotView {
  id: string;
  version: number;
  builderVersion: string;
  reportingPeriod: string | null;
  computedAt: string;
  computedByUserId: string | null;
  totals: CarbonGraph['totals'];
  graph: CarbonGraph;
  hotspots: HotspotReport;
}

function attributionFor(methodologies: Set<string>, hasEmissions: boolean): NodeAttribution {
  if (!hasEmissions) return 'none';
  const specific = methodologies.has('supplier_specific');
  const spend = methodologies.has('spend_based');
  if (specific && spend) return 'mixed';
  if (spend && !specific) return 'spend_based';
  if (specific) return 'supplier_specific';
  return 'mixed';
}

export async function computeCarbonGraph(
  db: TenantDb,
  args: {
    organizationId: string;
    reportingPeriod?: string;
    computedByUserId?: string | null;
    requestId: string;
  },
): Promise<CarbonGraphSnapshotView> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: args.organizationId } });
  const period = activePeriod(org.reportingPeriodConfig, args.reportingPeriod);

  const suppliers = await db.supplier.findMany({
    where: { organizationId: args.organizationId, status: 'active' },
    include: {
      relationship: { select: { annualSpend: true, tier: true, category: true } },
      passports: { select: { id: true }, take: 1 },
      evidenceRefs: { select: { verified: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Attributed supplier emissions for the period.
  const emissionDps = await db.datapoint.findMany({
    where: {
      organizationId: args.organizationId,
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
      organizationId: args.organizationId,
      subjectType: 'supplier',
      supersededBy: { none: {} },
      metricKey: { startsWith: 'emission_' },
    },
    select: { subjectId: true, value: true },
  });
  const minTrust = new Map<string, number>();
  for (const t of trustRows) {
    const cur = minTrust.get(t.subjectId);
    if (cur == null || t.value < cur) minTrust.set(t.subjectId, t.value);
  }

  interface Agg {
    tco2e: number;
    provenanceRank: number;
    methodologies: Set<string>;
  }
  const bySupplier = new Map<string, Agg>();
  for (const d of emissionDps) {
    const agg = bySupplier.get(d.subjectId) ?? {
      tco2e: 0,
      provenanceRank: 0,
      methodologies: new Set<string>(),
    };
    agg.tco2e += d.valueNumeric ? Number(d.valueNumeric) : 0;
    agg.provenanceRank = Math.max(agg.provenanceRank, PROVENANCE_RANK[d.provenance as Provenance] ?? 0);
    const m = d.calculationId ? methodologyByCalc.get(d.calculationId) : undefined;
    if (m) agg.methodologies.add(m);
    bySupplier.set(d.subjectId, agg);
  }

  // The organization's own Scope 1 + Scope 2 as the root's direct emissions.
  const ownEmissions = await db.emission.findMany({
    where: {
      organizationId: args.organizationId,
      reportingPeriod: period,
      scope: { in: ['scope_1', 'scope_2_location', 'scope_2_market'] },
    },
    select: { scope: true, valueTco2e: true },
  });
  // Prefer market-based Scope 2 if present; else location-based.
  const s2Market = ownEmissions
    .filter((e) => e.scope === 'scope_2_market')
    .reduce((a, e) => a + Number(e.valueTco2e), 0);
  const s2Location = ownEmissions
    .filter((e) => e.scope === 'scope_2_location')
    .reduce((a, e) => a + Number(e.valueTco2e), 0);
  const s1 = ownEmissions
    .filter((e) => e.scope === 'scope_1')
    .reduce((a, e) => a + Number(e.valueTco2e), 0);
  const rootDirect = s1 + (s2Market > 0 ? s2Market : s2Location);

  const nodes: CarbonNodeInput[] = [
    {
      id: 'org',
      kind: 'organization',
      label: org.legalName,
      tier: 0,
      directTco2e: Number(rootDirect.toFixed(4)),
      attribution: rootDirect > 0 ? 'supplier_specific' : 'none',
      annualSpendEur: null,
      evidenceCoverage: null,
      hasPassport: false,
      trustScore: null,
    },
  ];
  for (const s of suppliers) {
    const agg = bySupplier.get(s.id);
    const verified = s.evidenceRefs.filter((e) => e.verified).length;
    const coverage = s.evidenceRefs.length > 0 ? verified / s.evidenceRefs.length : null;
    nodes.push({
      id: s.id,
      kind: 'supplier',
      label: s.name,
      tier: s.relationship?.tier ?? 1,
      directTco2e: agg ? Number(agg.tco2e.toFixed(4)) : 0,
      attribution: attributionFor(agg?.methodologies ?? new Set(), Boolean(agg && agg.tco2e > 0)),
      annualSpendEur: s.relationship?.annualSpend ? Number(s.relationship.annualSpend) : null,
      evidenceCoverage: coverage,
      hasPassport: s.passports.length > 0,
      trustScore: minTrust.get(s.id) ?? null,
    });
  }

  const supplierTierById = new Map(nodes.filter((n) => n.kind === 'supplier').map((n) => [n.id, n.tier]));

  // Edges: org → every active supplier, plus the declared upstream links.
  const declared = await db.supplyChainEdge.findMany({
    where: { organizationId: args.organizationId },
  });
  const edges: CarbonEdgeInput[] = [];
  for (const s of suppliers) {
    edges.push({ from: 'org', to: s.id, relationship: s.relationship?.category ?? null });
  }
  for (const e of declared) {
    let toId = e.toSupplierId;
    if (!toId || !supplierTierById.has(toId)) {
      // Synthetic node for a declared external upstream party.
      toId = `ext:${e.id}`;
      if (!nodes.some((n) => n.id === toId)) {
        const fromTier = supplierTierById.get(e.fromSupplierId) ?? 1;
        nodes.push({
          id: toId,
          kind: 'supplier',
          label: e.toLabel,
          tier: e.tier ?? fromTier + 1,
          directTco2e: 0,
          attribution: 'none',
          annualSpendEur: null,
          evidenceCoverage: null,
          hasPassport: false,
          trustScore: null,
        });
      }
    }
    edges.push({ from: e.fromSupplierId, to: toId, relationship: e.relationship });
  }

  const graph = buildCarbonGraph(nodes, edges, { rootId: 'org' });
  const hotspots = rankHotspots(graph);

  const last = await db.carbonGraphSnapshot.findFirst({
    where: { organizationId: args.organizationId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const row = await db.carbonGraphSnapshot.create({
    data: {
      organizationId: args.organizationId,
      version,
      builderVersion: graph.builderVersion,
      reportingPeriod: period,
      data: { graph, hotspots } as unknown as Prisma.InputJsonValue,
      nodeCount: graph.totals.nodes,
      edgeCount: graph.totals.edges,
      totalTco2e: graph.totals.totalTco2e.toFixed(6),
      attributedPct: Math.round(graph.totals.attributedPct),
      hotspotCount: hotspots.hotspotCount,
      computedByUserId: args.computedByUserId ?? null,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.computedByUserId ?? null,
    action: 'network.graph_computed',
    resourceType: 'carbon_graph_snapshot',
    resourceId: row.id,
    before: null,
    after: {
      version,
      period,
      nodes: graph.totals.nodes,
      totalTco2e: graph.totals.totalTco2e,
      hotspots: hotspots.hotspotCount,
    },
    requestId: args.requestId,
  });

  return toSnapshotView(row, graph, hotspots);
}

function toSnapshotView(
  row: {
    id: string;
    version: number;
    builderVersion: string;
    reportingPeriod: string | null;
    computedAt: Date;
    computedByUserId: string | null;
  },
  graph: CarbonGraph,
  hotspots: HotspotReport,
): CarbonGraphSnapshotView {
  return {
    id: row.id,
    version: row.version,
    builderVersion: row.builderVersion,
    reportingPeriod: row.reportingPeriod,
    computedAt: row.computedAt.toISOString(),
    computedByUserId: row.computedByUserId,
    totals: graph.totals,
    graph,
    hotspots,
  };
}

function readSnapshotData(data: unknown): { graph: CarbonGraph; hotspots: HotspotReport } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { graph?: CarbonGraph; hotspots?: HotspotReport };
  return d.graph && d.hotspots ? { graph: d.graph, hotspots: d.hotspots } : null;
}

export async function latestCarbonGraph(
  db: TenantDb,
  organizationId: string,
): Promise<CarbonGraphSnapshotView | null> {
  const row = await db.carbonGraphSnapshot.findFirst({
    where: { organizationId },
    orderBy: { version: 'desc' },
  });
  if (!row) return null;
  const parsed = readSnapshotData(row.data);
  if (!parsed) return null;
  return toSnapshotView(row, parsed.graph, parsed.hotspots);
}

export async function carbonGraphByVersion(
  db: TenantDb,
  organizationId: string,
  version: number,
): Promise<CarbonGraphSnapshotView | null> {
  const row = await db.carbonGraphSnapshot.findUnique({
    where: { organizationId_version: { organizationId, version } },
  });
  if (!row) return null;
  const parsed = readSnapshotData(row.data);
  if (!parsed) return null;
  return toSnapshotView(row, parsed.graph, parsed.hotspots);
}

export async function listCarbonGraphSnapshots(
  db: TenantDb,
  organizationId: string,
): Promise<
  Array<{
    version: number;
    builderVersion: string;
    reportingPeriod: string | null;
    totalTco2e: string;
    attributedPct: number;
    hotspotCount: number;
    nodeCount: number;
    computedAt: string;
  }>
> {
  const rows = await db.carbonGraphSnapshot.findMany({
    where: { organizationId },
    orderBy: { version: 'desc' },
    take: 50,
  });
  return rows.map((r) => ({
    version: r.version,
    builderVersion: r.builderVersion,
    reportingPeriod: r.reportingPeriod,
    totalTco2e: r.totalTco2e.toString(),
    attributedPct: r.attributedPct,
    hotspotCount: r.hotspotCount,
    nodeCount: r.nodeCount,
    computedAt: r.computedAt.toISOString(),
  }));
}

export interface CarbonGraphNodeTrace {
  version: number;
  node: CarbonGraph['nodes'][number];
  path: string[];
  pathLabels: string[];
  hops: number;
  calculations: Array<{
    id: string;
    resultTco2e: string;
    methodology: string;
    factorSource: string;
    reportingPeriod: string;
    evidenceCount: number;
  }>;
}

export async function carbonGraphNodeTrace(
  db: TenantDb,
  organizationId: string,
  nodeId: string,
  version?: number,
): Promise<CarbonGraphNodeTrace> {
  const snap = version
    ? await carbonGraphByVersion(db, organizationId, version)
    : await latestCarbonGraph(db, organizationId);
  if (!snap) throw AppError.notFound('network.no_graph', 'No carbon graph has been computed yet.');

  const node = snap.graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw AppError.notFound('network.node_not_found', 'That node is not in this graph.');

  const trace = tracePath(snap.graph, nodeId);
  const labelById = new Map(snap.graph.nodes.map((n) => [n.id, n.label]));

  let calculations: CarbonGraphNodeTrace['calculations'] = [];
  if (node.kind === 'supplier' && !nodeId.startsWith('ext:')) {
    const dps = await db.datapoint.findMany({
      where: {
        organizationId,
        subjectType: 'supplier',
        subjectId: nodeId,
        metricKey: { startsWith: 'emission_' },
        calculationId: { not: null },
        ...(snap.reportingPeriod ? { reportingPeriod: snap.reportingPeriod } : {}),
      },
      select: { calculationId: true },
    });
    const ids = [...new Set(dps.map((d) => d.calculationId).filter((x): x is string => !!x))];
    if (ids.length > 0) {
      const rows = await db.calculation.findMany({
        where: { id: { in: ids } },
        orderBy: { resultValueTco2e: 'desc' },
        take: 20,
        select: {
          id: true,
          resultValueTco2e: true,
          methodology: true,
          factorSource: true,
          reportingPeriod: true,
          activity: { select: { evidence: { select: { evidenceId: true } } } },
        },
      });
      calculations = rows.map((c) => ({
        id: c.id,
        resultTco2e: c.resultValueTco2e.toString(),
        methodology: c.methodology,
        factorSource: c.factorSource,
        reportingPeriod: c.reportingPeriod,
        evidenceCount: c.activity?.evidence.length ?? 0,
      }));
    }
  }

  return {
    version: snap.version,
    node,
    path: trace?.path ?? [nodeId],
    pathLabels: (trace?.path ?? [nodeId]).map((id) => labelById.get(id) ?? id),
    hops: trace?.hops ?? 0,
    calculations,
  };
}
