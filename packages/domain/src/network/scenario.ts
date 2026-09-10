import {
  buildCarbonGraph,
  rankHotspots,
  type CarbonEdgeInput,
  type CarbonGraph,
  type CarbonNodeInput,
  type HotspotReport,
} from './graph';

/**
 * Network scenario engine (Phase 14c) — pure, deterministic.
 *
 * Applies a set of interventions to a baseline supply-chain carbon graph and
 * re-runs the roll-up, so a decarbonisation commitment / supplier substitution /
 * removed input / rerouted flow propagates up the tree exactly the way the real
 * graph does. No AI, no I/O — `@trace/db/network.ts` reconstructs the baseline
 * node / edge lists from a stored `carbon_graph_snapshot`.
 */

export const NETWORK_SCENARIO_ENGINE_VERSION = 'network-scenario@1.0.0';

export type NetworkInterventionKind =
  | 'decarbonize'
  | 'substitute'
  | 'drop_node'
  | 'reroute';

export interface NetworkIntervention {
  id: string;
  kind: NetworkInterventionKind;
  label?: string;
  /** Target node for `decarbonize` / `substitute` / `drop_node`. */
  nodeId?: string;
  /** `decarbonize`: percentage cut to the node's direct emissions, 0..100. */
  reductionPct?: number;
  /** `substitute`: the node's new absolute direct emissions, tCO2e. */
  newDirectTco2e?: number;
  /** `reroute`: the declared edge to move (`fromNodeId` → `currentToNodeId`) … */
  fromNodeId?: string;
  currentToNodeId?: string;
  /** … and its new target node. */
  newToNodeId?: string;
}

export interface ApplyNetworkScenarioInput {
  nodes: CarbonNodeInput[];
  edges: CarbonEdgeInput[];
  rootId?: string;
  interventions: NetworkIntervention[];
}

export interface AppliedIntervention {
  id: string;
  kind: NetworkInterventionKind;
  label: string;
  ok: boolean;
  effect: string;
}

export interface NodeDelta {
  id: string;
  label: string;
  tier: number | null;
  baselineTotalTco2e: number;
  projectedTotalTco2e: number;
  deltaTco2e: number;
  deltaPct: number | null;
}

export interface NetworkScenarioResult {
  engineVersion: string;
  baseline: { totalTco2e: number; hotspotCount: number };
  projected: { totalTco2e: number; hotspotCount: number };
  deltaTco2e: number;
  deltaPct: number | null;
  nodeDeltas: NodeDelta[];
  appliedInterventions: AppliedIntervention[];
  projectedGraph: CarbonGraph;
  projectedHotspots: HotspotReport;
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function clampPct(n: number | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function applyNetworkScenario(
  input: ApplyNetworkScenarioInput,
): NetworkScenarioResult {
  const baselineGraph = buildCarbonGraph(input.nodes, input.edges, { rootId: input.rootId });
  const baselineHotspots = rankHotspots(baselineGraph);

  let nodes: CarbonNodeInput[] = input.nodes.map((n) => ({ ...n }));
  let edges: CarbonEdgeInput[] = input.edges.map((e) => ({ ...e }));
  const applied: AppliedIntervention[] = [];
  const findNode = (id: string | undefined): CarbonNodeInput | undefined =>
    id ? nodes.find((n) => n.id === id) : undefined;

  for (const iv of input.interventions) {
    const label = iv.label?.trim() || defaultLabel(iv);
    if (iv.kind === 'decarbonize') {
      const node = findNode(iv.nodeId);
      if (!node) {
        applied.push({ id: iv.id, kind: iv.kind, label, ok: false, effect: 'node not found' });
        continue;
      }
      const pct = clampPct(iv.reductionPct);
      const before = node.directTco2e;
      node.directTco2e = round(before * (1 - pct / 100));
      applied.push({
        id: iv.id,
        kind: iv.kind,
        label,
        ok: true,
        effect: `−${pct}% direct: ${round(before)} → ${node.directTco2e} tCO2e`,
      });
    } else if (iv.kind === 'substitute') {
      const node = findNode(iv.nodeId);
      if (!node || typeof iv.newDirectTco2e !== 'number' || iv.newDirectTco2e < 0) {
        applied.push({
          id: iv.id,
          kind: iv.kind,
          label,
          ok: false,
          effect: !node ? 'node not found' : 'a non-negative newDirectTco2e is required',
        });
        continue;
      }
      const before = node.directTco2e;
      node.directTco2e = round(iv.newDirectTco2e);
      node.attribution = 'supplier_specific';
      applied.push({
        id: iv.id,
        kind: iv.kind,
        label,
        ok: true,
        effect: `direct: ${round(before)} → ${node.directTco2e} tCO2e`,
      });
    } else if (iv.kind === 'drop_node') {
      const node = findNode(iv.nodeId);
      if (!node || node.id === (input.rootId ?? 'org')) {
        applied.push({
          id: iv.id,
          kind: iv.kind,
          label,
          ok: false,
          effect: !node ? 'node not found' : 'cannot drop the root',
        });
        continue;
      }
      const removedEdges = edges.filter((e) => e.from === node.id || e.to === node.id).length;
      nodes = nodes.filter((n) => n.id !== node.id);
      edges = edges.filter((e) => e.from !== node.id && e.to !== node.id);
      applied.push({
        id: iv.id,
        kind: iv.kind,
        label,
        ok: true,
        effect: `removed node and ${removedEdges} edge(s)`,
      });
    } else if (iv.kind === 'reroute') {
      const edge = edges.find(
        (e) => e.from === iv.fromNodeId && e.to === iv.currentToNodeId,
      );
      const target = findNode(iv.newToNodeId);
      if (!edge || !target) {
        applied.push({
          id: iv.id,
          kind: iv.kind,
          label,
          ok: false,
          effect: !edge ? 'edge not found' : 'new target node not found',
        });
        continue;
      }
      const oldTo = edge.to;
      edge.to = target.id;
      applied.push({
        id: iv.id,
        kind: iv.kind,
        label,
        ok: true,
        effect: `${edge.from}: ${oldTo} → ${target.id}`,
      });
    }
  }

  const projectedGraph = buildCarbonGraph(nodes, edges, { rootId: input.rootId });
  const projectedHotspots = rankHotspots(projectedGraph);

  const baseTotalById = new Map(baselineGraph.nodes.map((n) => [n.id, n.totalTco2e]));
  const projTotalById = new Map(projectedGraph.nodes.map((n) => [n.id, n.totalTco2e]));
  const labelById = new Map<string, { label: string; tier: number | null }>();
  for (const n of [...baselineGraph.nodes, ...projectedGraph.nodes]) {
    labelById.set(n.id, { label: n.label, tier: n.tier });
  }

  const nodeDeltas: NodeDelta[] = [...new Set([...baseTotalById.keys(), ...projTotalById.keys()])]
    .map((id) => {
      const b = baseTotalById.get(id) ?? 0;
      const p = projTotalById.get(id) ?? 0;
      const meta = labelById.get(id) ?? { label: id, tier: null };
      return {
        id,
        label: meta.label,
        tier: meta.tier,
        baselineTotalTco2e: round(b),
        projectedTotalTco2e: round(p),
        deltaTco2e: round(p - b),
        deltaPct: b > 0 ? round(((p - b) / b) * 100, 2) : null,
      };
    })
    .filter((d) => d.deltaTco2e !== 0)
    .sort((a, b) => Math.abs(b.deltaTco2e) - Math.abs(a.deltaTco2e));

  const baseTotal = baselineGraph.totals.totalTco2e;
  const projTotal = projectedGraph.totals.totalTco2e;
  const deltaTco2e = round(projTotal - baseTotal);

  return {
    engineVersion: NETWORK_SCENARIO_ENGINE_VERSION,
    baseline: { totalTco2e: baseTotal, hotspotCount: baselineHotspots.hotspotCount },
    projected: { totalTco2e: projTotal, hotspotCount: projectedHotspots.hotspotCount },
    deltaTco2e,
    deltaPct: baseTotal > 0 ? round((deltaTco2e / baseTotal) * 100, 2) : null,
    nodeDeltas,
    appliedInterventions: applied,
    projectedGraph,
    projectedHotspots,
  };
}

function defaultLabel(iv: NetworkIntervention): string {
  switch (iv.kind) {
    case 'decarbonize':
      return `Decarbonise ${iv.nodeId ?? '?'} by ${clampPct(iv.reductionPct)}%`;
    case 'substitute':
      return `Substitute ${iv.nodeId ?? '?'}`;
    case 'drop_node':
      return `Remove ${iv.nodeId ?? '?'}`;
    case 'reroute':
      return `Reroute ${iv.fromNodeId ?? '?'} → ${iv.newToNodeId ?? '?'}`;
    default:
      return 'Intervention';
  }
}
