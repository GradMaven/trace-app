import { describe, expect, it } from 'vitest';
import {
  buildCarbonGraph,
  CARBON_GRAPH_BUILDER_VERSION,
  rankHotspots,
  tracePath,
  type CarbonEdgeInput,
  type CarbonNodeInput,
} from './graph';

function orgNode(over: Partial<CarbonNodeInput> = {}): CarbonNodeInput {
  return {
    id: 'org',
    kind: 'organization',
    label: 'NordWerk',
    tier: 0,
    directTco2e: 0,
    attribution: 'none',
    annualSpendEur: null,
    evidenceCoverage: null,
    hasPassport: false,
    trustScore: null,
    ...over,
  };
}
function supplier(id: string, over: Partial<CarbonNodeInput> = {}): CarbonNodeInput {
  return {
    id,
    kind: 'supplier',
    label: id.toUpperCase(),
    tier: 1,
    directTco2e: 0,
    attribution: 'supplier_specific',
    annualSpendEur: null,
    evidenceCoverage: 1,
    hasPassport: true,
    trustScore: 80,
    ...over,
  };
}

describe('buildCarbonGraph', () => {
  it('rolls direct emissions up the edges and weights org edges by total', () => {
    const nodes = [
      orgNode(),
      supplier('steel', { directTco2e: 100, annualSpendEur: 500_000 }),
      supplier('logistics', { directTco2e: 40 }),
      supplier('ore', { tier: 2, directTco2e: 60 }),
    ];
    const edges: CarbonEdgeInput[] = [
      { from: 'org', to: 'steel', relationship: null },
      { from: 'org', to: 'logistics', relationship: null },
      { from: 'steel', to: 'ore', relationship: 'raw material' },
    ];
    const g = buildCarbonGraph(nodes, edges);
    expect(g.builderVersion).toBe(CARBON_GRAPH_BUILDER_VERSION);

    const steel = g.nodes.find((n) => n.id === 'steel')!;
    expect(steel.upstreamTco2e).toBe(60);
    expect(steel.totalTco2e).toBe(160);
    expect(steel.intensityTco2ePerKEur).toBe(0.2); // 100 / (500_000/1000)
    expect(steel.depth).toBe(1);
    expect(g.nodes.find((n) => n.id === 'ore')!.depth).toBe(2);

    const orgNodeOut = g.nodes.find((n) => n.id === 'org')!;
    expect(orgNodeOut.totalTco2e).toBe(200); // 100 + 40 + 60

    const steelEdge = g.edges.find((e) => e.from === 'org' && e.to === 'steel')!;
    expect(steelEdge.tco2e).toBe(160);
    expect(steelEdge.share).toBeCloseTo(0.8, 5);
    expect(steelEdge.kind).toBe('attributed');

    expect(g.totals).toMatchObject({ suppliers: 3, totalTco2e: 200, maxDepth: 2 });
  });

  it('does not double-count a diamond dependency', () => {
    const nodes = [
      orgNode(),
      supplier('a', { directTco2e: 10 }),
      supplier('b', { directTco2e: 10 }),
      supplier('shared', { tier: 2, directTco2e: 50 }),
    ];
    const edges: CarbonEdgeInput[] = [
      { from: 'org', to: 'a', relationship: null },
      { from: 'org', to: 'b', relationship: null },
      { from: 'a', to: 'shared', relationship: null },
      { from: 'b', to: 'shared', relationship: null },
    ];
    const g = buildCarbonGraph(nodes, edges);
    expect(g.nodes.find((n) => n.id === 'a')!.upstreamTco2e).toBe(50);
    expect(g.nodes.find((n) => n.id === 'b')!.upstreamTco2e).toBe(50);
    // org total is direct-sum, each shared counted once
    expect(g.nodes.find((n) => n.id === 'org')!.totalTco2e).toBe(70);
  });

  it('flags a cycle and still produces a graph', () => {
    const nodes = [orgNode(), supplier('x', { directTco2e: 5 }), supplier('y', { tier: 2, directTco2e: 5 })];
    const edges: CarbonEdgeInput[] = [
      { from: 'org', to: 'x', relationship: null },
      { from: 'x', to: 'y', relationship: null },
      { from: 'y', to: 'x', relationship: null },
    ];
    const g = buildCarbonGraph(nodes, edges);
    expect(g.cycleWarnings.some((w) => /cycle/.test(w))).toBe(true);
    expect(g.totals.totalTco2e).toBe(10);
  });

  it('reports attribution + evidence coverage', () => {
    const nodes = [
      orgNode(),
      supplier('primary', { directTco2e: 80, attribution: 'supplier_specific', evidenceCoverage: 1 }),
      supplier('estimate', { directTco2e: 20, attribution: 'spend_based', evidenceCoverage: 0 }),
    ];
    const g = buildCarbonGraph(nodes, [
      { from: 'org', to: 'primary', relationship: null },
      { from: 'org', to: 'estimate', relationship: null },
    ]);
    expect(g.totals.supplierSpecificTco2e).toBe(80);
    expect(g.totals.spendBasedTco2e).toBe(20);
    expect(g.totals.attributedPct).toBe(80);
    expect(g.totals.evidenceBackedPct).toBe(80); // (80*1 + 20*0) / 100
  });
});

describe('rankHotspots', () => {
  const nodes = [
    orgNode(),
    supplier('big', { directTco2e: 700, annualSpendEur: 1_000_000 }),
    supplier('mid', { directTco2e: 200, annualSpendEur: 100_000 }), // high intensity
    supplier('small', { directTco2e: 100, annualSpendEur: 1_000_000 }),
  ];
  const edges: CarbonEdgeInput[] = nodes
    .filter((n) => n.kind === 'supplier')
    .map((n) => ({ from: 'org', to: n.id, relationship: null }));

  it('marks the Pareto set and explains why', () => {
    const g = buildCarbonGraph(nodes, edges);
    const report = rankHotspots(g, { coverageTarget: 0.8 });
    expect(report.nodes[0]!.id).toBe('big');
    expect(report.nodes[0]!.rank).toBe(1);
    expect(report.nodes[0]!.sharePct).toBe(70);
    // 70% then 90% → cut at rank 2
    expect(report.hotspotCount).toBe(2);
    expect(report.nodes.find((n) => n.id === 'small')!.isHotspot).toBe(false);
    expect(report.nodes.find((n) => n.id === 'big')!.reasons).toContain('top contributor');
    expect(report.nodes.find((n) => n.id === 'mid')!.reasons).toContain(
      'above-median carbon intensity',
    );
  });

  it('handles a graph with no emissions', () => {
    const g = buildCarbonGraph([orgNode(), supplier('z', { directTco2e: 0, attribution: 'none' })], [
      { from: 'org', to: 'z', relationship: null },
    ]);
    const r = rankHotspots(g);
    expect(r.hotspotCount).toBe(0);
    expect(r.nodes[0]!.reasons).toContain('no attributed emissions');
  });
});

describe('tracePath', () => {
  it('returns the shortest hop path from the root', () => {
    const nodes = [orgNode(), supplier('a'), supplier('deep', { tier: 3 })];
    const g = buildCarbonGraph(nodes, [
      { from: 'org', to: 'a', relationship: null },
      { from: 'a', to: 'deep', relationship: null },
    ]);
    expect(tracePath(g, 'deep')).toEqual({ path: ['org', 'a', 'deep'], hops: 2 });
    expect(tracePath(g, 'org')).toEqual({ path: ['org'], hops: 0 });
    expect(tracePath(g, 'missing')).toBeNull();
  });
});
