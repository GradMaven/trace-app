/**
 * Supply-chain carbon graph (Phase 14 — "Carbon Twin"). Pure, deterministic.
 *
 * Given a set of nodes (the organization root + its suppliers, each carrying the
 * carbon attributed directly to it) and a set of directed edges (org → supplier
 * from attribution, supplier → supplier from tenant-declared links), this builds
 * a rolled-up graph: every node's `upstreamTco2e` is the sum of its unique
 * descendants' direct emissions (DAG-safe, cycle-guarded), and every edge from
 * the root is weighted by the contribution flowing through it. `rankHotspots`
 * then produces a Pareto ranking of the supplier nodes with explainable reasons.
 *
 * No AI, no I/O. `@trace/db/network.ts` gathers the inputs from real rows.
 */

export const CARBON_GRAPH_BUILDER_VERSION = 'carbon-graph@1.0.0';
export const HOTSPOT_COVERAGE_TARGET = 0.8;
export const MAX_GRAPH_DEPTH = 8;

export type NodeAttribution = 'supplier_specific' | 'spend_based' | 'mixed' | 'none';

export interface CarbonNodeInput {
  id: string;
  kind: 'organization' | 'supplier';
  label: string;
  tier: number | null;
  /** Emissions attributed directly to this node for the period, tCO2e. */
  directTco2e: number;
  attribution: NodeAttribution;
  annualSpendEur: number | null;
  /** 0..1 — share of this node's direct emissions backed by verified evidence. */
  evidenceCoverage: number | null;
  hasPassport: boolean;
  /** Lowest Trust Score among the node's emission datapoints, 0..100 or null. */
  trustScore: number | null;
}

export interface CarbonEdgeInput {
  from: string;
  to: string;
  relationship: string | null;
}

export interface CarbonGraphNode extends CarbonNodeInput {
  upstreamTco2e: number;
  totalTco2e: number;
  intensityTco2ePerKEur: number | null;
  childIds: string[];
  parentIds: string[];
  /** Shortest hop count from the root; null if unreachable from the root. */
  depth: number | null;
}

export interface CarbonGraphEdge {
  from: string;
  to: string;
  relationship: string | null;
  /** Contribution flowing through this edge, tCO2e. null = structural only. */
  tco2e: number | null;
  /** Share of the root total, 0..1. null when not weightable. */
  share: number | null;
  kind: 'attributed' | 'declared';
}

export interface CarbonGraph {
  builderVersion: string;
  rootId: string;
  nodes: CarbonGraphNode[];
  edges: CarbonGraphEdge[];
  totals: {
    nodes: number;
    suppliers: number;
    edges: number;
    totalTco2e: number;
    supplierSpecificTco2e: number;
    spendBasedTco2e: number;
    unattributedSuppliers: number;
    attributedPct: number;
    evidenceBackedPct: number;
    maxDepth: number;
  };
  cycleWarnings: string[];
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}
function pushInto(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Build the rolled-up carbon graph. `rootId` defaults to the single
 * `kind: 'organization'` node. Edges referencing an unknown `to` are dropped
 * (the DB layer is expected to pass a stub node for declared external parties).
 */
export function buildCarbonGraph(
  nodeInputs: readonly CarbonNodeInput[],
  edgeInputs: readonly CarbonEdgeInput[],
  opts: { rootId?: string } = {},
): CarbonGraph {
  const byId = new Map(nodeInputs.map((n) => [n.id, n]));
  const root =
    (opts.rootId && byId.get(opts.rootId)) ??
    nodeInputs.find((n) => n.kind === 'organization') ??
    nodeInputs[0];
  if (!root) {
    return {
      builderVersion: CARBON_GRAPH_BUILDER_VERSION,
      rootId: '',
      nodes: [],
      edges: [],
      totals: {
        nodes: 0,
        suppliers: 0,
        edges: 0,
        totalTco2e: 0,
        supplierSpecificTco2e: 0,
        spendBasedTco2e: 0,
        unattributedSuppliers: 0,
        attributedPct: 0,
        evidenceBackedPct: 0,
        maxDepth: 0,
      },
      cycleWarnings: [],
    };
  }

  const cleanEdges = edgeInputs.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
  const adjacency = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const e of cleanEdges) {
    pushInto(adjacency, e.from, e.to);
    pushInto(parents, e.to, e.from);
  }

  const cycleWarnings: string[] = [];

  // Unique descendants of a node (DAG-safe, depth-capped, cycle-guarded).
  const descendantCache = new Map<string, Set<string>>();
  function descendants(startId: string): Set<string> {
    const cached = descendantCache.get(startId);
    if (cached) return cached;
    const out = new Set<string>();
    const walk = (id: string, depth: number, ancestry: Set<string>): void => {
      if (depth > MAX_GRAPH_DEPTH) {
        cycleWarnings.push(`depth limit reached at "${id}"`);
        return;
      }
      for (const child of adjacency.get(id) ?? []) {
        if (ancestry.has(child)) {
          cycleWarnings.push(`cycle: ${id} → ${child}`);
          continue;
        }
        if (!out.has(child)) {
          out.add(child);
          walk(child, depth + 1, new Set([...ancestry, child]));
        }
      }
    };
    walk(startId, 0, new Set([startId]));
    descendantCache.set(startId, out);
    return out;
  }

  // Shortest depth from the root (BFS over the cleaned edges).
  const depthById = new Map<string, number>([[root.id, 0]]);
  const queue: string[] = [root.id];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depthById.get(cur)!;
    for (const child of adjacency.get(cur) ?? []) {
      if (!depthById.has(child)) {
        depthById.set(child, d + 1);
        queue.push(child);
      }
    }
  }

  const nodes: CarbonGraphNode[] = nodeInputs.map((n) => {
    const desc = descendants(n.id);
    let upstream = 0;
    for (const id of desc) upstream += byId.get(id)?.directTco2e ?? 0;
    const intensity =
      n.annualSpendEur != null && n.annualSpendEur > 0
        ? round(n.directTco2e / (n.annualSpendEur / 1000), 4)
        : null;
    return {
      ...n,
      upstreamTco2e: round(upstream, 4),
      totalTco2e: round(n.directTco2e + upstream, 4),
      intensityTco2ePerKEur: intensity,
      childIds: [...new Set(adjacency.get(n.id) ?? [])],
      parentIds: [...new Set(parents.get(n.id) ?? [])],
      depth: depthById.has(n.id) ? depthById.get(n.id)! : null,
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rootTotal = nodeById.get(root.id)!.totalTco2e;

  const edges: CarbonGraphEdge[] = cleanEdges.map((e) => {
    const toNode = nodeById.get(e.to)!;
    const weight =
      e.from === root.id
        ? toNode.totalTco2e
        : toNode.totalTco2e > 0
          ? toNode.totalTco2e
          : null;
    return {
      from: e.from,
      to: e.to,
      relationship: e.relationship,
      tco2e: weight,
      share: weight != null && rootTotal > 0 ? round(weight / rootTotal, 6) : null,
      kind: weight != null ? 'attributed' : 'declared',
    };
  });

  const suppliers = nodes.filter((n) => n.kind === 'supplier');
  const supplierSpecific = suppliers
    .filter((n) => n.attribution === 'supplier_specific' || n.attribution === 'mixed')
    .reduce((a, n) => a + n.directTco2e, 0);
  const spendBased = suppliers
    .filter((n) => n.attribution === 'spend_based')
    .reduce((a, n) => a + n.directTco2e, 0);
  const directTotal = suppliers.reduce((a, n) => a + n.directTco2e, 0);
  const evidenceWeighted = suppliers.reduce(
    (a, n) => a + n.directTco2e * (n.evidenceCoverage ?? 0),
    0,
  );
  const maxDepth = Math.max(0, ...[...depthById.values()]);

  return {
    builderVersion: CARBON_GRAPH_BUILDER_VERSION,
    rootId: root.id,
    nodes,
    edges,
    totals: {
      nodes: nodes.length,
      suppliers: suppliers.length,
      edges: edges.length,
      totalTco2e: rootTotal,
      supplierSpecificTco2e: round(supplierSpecific, 4),
      spendBasedTco2e: round(spendBased, 4),
      unattributedSuppliers: suppliers.filter((n) => n.attribution === 'none').length,
      attributedPct: directTotal > 0 ? round((supplierSpecific / directTotal) * 100, 1) : 0,
      evidenceBackedPct: directTotal > 0 ? round((evidenceWeighted / directTotal) * 100, 1) : 0,
      maxDepth,
    },
    cycleWarnings: [...new Set(cycleWarnings)],
  };
}

// ---------------------------------------------------------------------------
// Hotspot ranking
// ---------------------------------------------------------------------------

export interface HotspotNode {
  id: string;
  label: string;
  tier: number | null;
  totalTco2e: number;
  directTco2e: number;
  sharePct: number;
  cumulativeSharePct: number;
  rank: number;
  isHotspot: boolean;
  intensityTco2ePerKEur: number | null;
  intensityVsMedian: number | null;
  reasons: string[];
}

export interface HotspotReport {
  builderVersion: string;
  coverageTarget: number;
  hotspotCount: number;
  cumulativeSharePctAtCut: number;
  medianIntensityTco2ePerKEur: number | null;
  nodes: HotspotNode[];
}

export function rankHotspots(
  graph: CarbonGraph,
  opts: { coverageTarget?: number } = {},
): HotspotReport {
  const target = opts.coverageTarget ?? HOTSPOT_COVERAGE_TARGET;
  const suppliers = graph.nodes
    .filter((n) => n.kind === 'supplier')
    .sort((a, b) => b.totalTco2e - a.totalTco2e || a.label.localeCompare(b.label));

  const grandTotal = suppliers.reduce((a, n) => a + n.totalTco2e, 0);
  const medianIntensity = median(
    suppliers
      .map((n) => n.intensityTco2ePerKEur)
      .filter((x): x is number => x != null && x > 0),
  );

  // First pass: the rank at which cumulative share first reaches the target.
  let running = 0;
  let cutRank = suppliers.length;
  for (let i = 0; i < suppliers.length; i += 1) {
    running += suppliers[i]!.totalTco2e;
    if (grandTotal > 0 && running / grandTotal >= target) {
      cutRank = i + 1;
      break;
    }
  }

  let cumulative = 0;
  const nodes: HotspotNode[] = suppliers.map((n, i) => {
    const rank = i + 1;
    const sharePct = grandTotal > 0 ? round((n.totalTco2e / grandTotal) * 100, 2) : 0;
    cumulative += sharePct;
    const isHotspot = grandTotal > 0 && rank <= cutRank && n.totalTco2e > 0;

    const intensityVsMedian =
      n.intensityTco2ePerKEur != null && medianIntensity != null && medianIntensity > 0
        ? round(n.intensityTco2ePerKEur / medianIntensity, 3)
        : null;

    const reasons: string[] = [];
    if (isHotspot && sharePct >= 5) reasons.push('top contributor');
    if (intensityVsMedian != null && intensityVsMedian > 1.25) {
      reasons.push('above-median carbon intensity');
    }
    if (n.attribution === 'spend_based') reasons.push('spend-based estimate');
    else if (n.attribution === 'none') reasons.push('no attributed emissions');
    if (n.evidenceCoverage == null) reasons.push('evidence coverage unknown');
    else if (n.evidenceCoverage < 0.5) reasons.push('little verified evidence');
    if (n.trustScore != null && n.trustScore < 50) reasons.push('low Trust Score');
    if (!n.hasPassport && (n.tier ?? 9) <= 1 && n.totalTco2e > 1) {
      reasons.push('tier-1 supplier without a passport');
    }

    return {
      id: n.id,
      label: n.label,
      tier: n.tier,
      totalTco2e: n.totalTco2e,
      directTco2e: n.directTco2e,
      sharePct,
      cumulativeSharePct: round(cumulative, 2),
      rank,
      isHotspot,
      intensityTco2ePerKEur: n.intensityTco2ePerKEur,
      intensityVsMedian,
      reasons,
    };
  });

  const hotspotCount = nodes.filter((n) => n.isHotspot).length;
  const cumulativeAtCut =
    hotspotCount > 0 ? (nodes[hotspotCount - 1]?.cumulativeSharePct ?? 0) : 0;

  return {
    builderVersion: graph.builderVersion,
    coverageTarget: target,
    hotspotCount,
    cumulativeSharePctAtCut: cumulativeAtCut,
    medianIntensityTco2ePerKEur: medianIntensity != null ? round(medianIntensity, 4) : null,
    nodes,
  };
}

// ---------------------------------------------------------------------------
// Path tracing
// ---------------------------------------------------------------------------

export interface GraphPath {
  path: string[];
  hops: number;
}

/** Shortest path (by hop count) from the root to `nodeId`. */
export function tracePath(graph: CarbonGraph, nodeId: string): GraphPath | null {
  if (nodeId === graph.rootId) return { path: [graph.rootId], hops: 0 };
  const adjacency = new Map<string, string[]>();
  for (const e of graph.edges) pushInto(adjacency, e.from, e.to);
  const prev = new Map<string, string>();
  const seen = new Set([graph.rootId]);
  const queue = [graph.rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === nodeId) {
      const path = [cur];
      let p = cur;
      while (prev.has(p)) {
        p = prev.get(p)!;
        path.unshift(p);
      }
      return { path, hops: path.length - 1 };
    }
    for (const child of adjacency.get(cur) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        prev.set(child, cur);
        queue.push(child);
      }
    }
  }
  return null;
}
