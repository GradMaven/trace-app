import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { NetworkScenarioBuilder } from './scenario-client';

export const dynamic = 'force-dynamic';

interface GraphNode {
  id: string;
  kind: string;
  label: string;
  tier: number | null;
  directTco2e: number;
  totalTco2e: number;
}
interface GraphEdge {
  from: string;
  to: string;
}
interface Snapshot {
  version: number;
  graph: { rootId: string; nodes: GraphNode[]; edges: GraphEdge[] };
  totals: { totalTco2e: number };
}
export interface SavedScenario {
  id: string;
  name: string;
  baseGraphVersion: number;
  baselineTco2e: string;
  projectedTco2e: string;
  deltaTco2e: string;
  deltaPct: string;
  interventions: number;
  createdAt: string;
}

export default async function NetworkScenariosPage() {
  const [graphRes, listRes] = await Promise.all([
    serverFetch<Snapshot>('/network/graph'),
    serverFetch<SavedScenario[]>('/network/scenarios'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 900 }}>
      <div>
        <Link href="/supply-chain/carbon-twin" className="muted" style={{ fontSize: 13 }}>
          ← Carbon Twin
        </Link>
        <h1 style={{ fontSize: 20, margin: '4px 0 0' }}>Carbon Twin — network scenarios</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          What-ifs over the latest supply-chain carbon graph: decarbonise a node, substitute an
          upstream supplier, drop an input, or reroute a declared link — the change is propagated
          up the tree exactly the way the real graph rolls up. Saved scenarios are immutable.
        </p>
      </div>

      {!graphRes.data ? (
        <section className="card">
          <p style={{ marginTop: 0 }}>
            {graphRes.error?.message ?? 'Compute the carbon graph first, then run scenarios here.'}
          </p>
        </section>
      ) : (
        <NetworkScenarioBuilder
          baseVersion={graphRes.data.version}
          nodes={graphRes.data.graph.nodes.map((n) => ({
            id: n.id,
            label: n.label,
            kind: n.kind,
            tier: n.tier,
            directTco2e: n.directTco2e,
            totalTco2e: n.totalTco2e,
          }))}
          edges={graphRes.data.graph.edges.map((e) => ({ from: e.from, to: e.to }))}
          saved={listRes.data ?? []}
        />
      )}
    </div>
  );
}
