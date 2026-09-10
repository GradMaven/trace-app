import { describe, expect, it } from 'vitest';
import {
  applyNetworkScenario,
  NETWORK_SCENARIO_ENGINE_VERSION,
  type NetworkIntervention,
} from './scenario';
import type { CarbonEdgeInput, CarbonNodeInput } from './graph';

function org(): CarbonNodeInput {
  return {
    id: 'org',
    kind: 'organization',
    label: 'Org',
    tier: 0,
    directTco2e: 0,
    attribution: 'none',
    annualSpendEur: null,
    evidenceCoverage: null,
    hasPassport: false,
    trustScore: null,
  };
}
function supplier(id: string, direct: number, tier = 1): CarbonNodeInput {
  return {
    id,
    kind: 'supplier',
    label: id.toUpperCase(),
    tier,
    directTco2e: direct,
    attribution: 'supplier_specific',
    annualSpendEur: 1_000_000,
    evidenceCoverage: 1,
    hasPassport: true,
    trustScore: 80,
  };
}

// org → steel → ore ; org → logistics
const NODES: CarbonNodeInput[] = [
  org(),
  supplier('steel', 100),
  supplier('ore', 60, 2),
  supplier('logistics', 40),
];
const EDGES: CarbonEdgeInput[] = [
  { from: 'org', to: 'steel', relationship: null },
  { from: 'org', to: 'logistics', relationship: null },
  { from: 'steel', to: 'ore', relationship: 'raw material' },
];

function run(interventions: NetworkIntervention[]) {
  return applyNetworkScenario({ nodes: NODES, edges: EDGES, rootId: 'org', interventions });
}

describe('applyNetworkScenario', () => {
  it('reports the unchanged baseline for no interventions', () => {
    const r = run([]);
    expect(r.engineVersion).toBe(NETWORK_SCENARIO_ENGINE_VERSION);
    expect(r.baseline.totalTco2e).toBe(200);
    expect(r.projected.totalTco2e).toBe(200);
    expect(r.deltaTco2e).toBe(0);
    expect(r.nodeDeltas).toEqual([]);
  });

  it('decarbonising a leaf propagates up the tree', () => {
    const r = run([{ id: 'i1', kind: 'decarbonize', nodeId: 'ore', reductionPct: 50 }]);
    // ore direct 60 → 30, so steel total 100+30 and org total 170
    expect(r.projected.totalTco2e).toBe(170);
    expect(r.deltaTco2e).toBe(-30);
    const steel = r.nodeDeltas.find((d) => d.id === 'steel')!;
    expect(steel.deltaTco2e).toBe(-30);
    const orgDelta = r.nodeDeltas.find((d) => d.id === 'org')!;
    expect(orgDelta.deltaTco2e).toBe(-30);
    expect(r.appliedInterventions[0]!.ok).toBe(true);
  });

  it('substitute sets a node absolute direct value', () => {
    const r = run([{ id: 'i1', kind: 'substitute', nodeId: 'steel', newDirectTco2e: 40 }]);
    expect(r.projected.totalTco2e).toBe(140); // 40 + 60 (ore) + 40 (logistics)
    expect(r.appliedInterventions[0]!.ok).toBe(true);
  });

  it('drop_node removes the node and its rolled-up contribution', () => {
    const r = run([{ id: 'i1', kind: 'drop_node', nodeId: 'steel' }]);
    // removing steel drops its direct 100 and cuts the steel→ore edge; ore no longer reachable from org
    expect(r.projected.totalTco2e).toBe(40); // only logistics remains under org... plus ore still a node with direct 60 but no path
    // org total = sum of supplier direct still present = ore 60 + logistics 40 (buildCarbonGraph totals = root total)
    expect(r.projectedGraph.nodes.find((n) => n.id === 'steel')).toBeUndefined();
  });

  it('refuses an unknown node and leaves the graph unchanged', () => {
    const r = run([{ id: 'i1', kind: 'decarbonize', nodeId: 'ghost', reductionPct: 90 }]);
    expect(r.appliedInterventions[0]!.ok).toBe(false);
    expect(r.deltaTco2e).toBe(0);
  });

  it('reroute moves a declared edge to a new target', () => {
    const r = run([
      {
        id: 'i1',
        kind: 'reroute',
        fromNodeId: 'steel',
        currentToNodeId: 'ore',
        newToNodeId: 'logistics',
      },
    ]);
    expect(r.appliedInterventions[0]!.ok).toBe(true);
    // steel now points at logistics (40); its total 100 + 40 = 140
    const steel = r.projectedGraph.nodes.find((n) => n.id === 'steel')!;
    expect(steel.totalTco2e).toBe(140);
  });

  it('applies several interventions together and computes deltaPct', () => {
    const r = run([
      { id: 'i1', kind: 'decarbonize', nodeId: 'steel', reductionPct: 20 },
      { id: 'i2', kind: 'drop_node', nodeId: 'logistics' },
    ]);
    // steel 100 → 80 (−20); logistics gone (−40); total 200 → 140
    expect(r.projected.totalTco2e).toBe(140);
    expect(r.deltaTco2e).toBe(-60);
    expect(r.deltaPct).toBe(-30);
  });
});
