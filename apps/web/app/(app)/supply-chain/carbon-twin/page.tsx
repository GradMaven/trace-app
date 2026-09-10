import Link from 'next/link';
import { serverFetch } from '@/lib/server-api';
import { CarbonTwinTools } from './carbon-twin-client';

export const dynamic = 'force-dynamic';

interface GraphNode {
  id: string;
  kind: 'organization' | 'supplier';
  label: string;
  tier: number | null;
  directTco2e: number;
  upstreamTco2e: number;
  totalTco2e: number;
  attribution: string;
  intensityTco2ePerKEur: number | null;
  evidenceCoverage: number | null;
  hasPassport: boolean;
  depth: number | null;
}
interface HotspotNode {
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
export interface Snapshot {
  id: string;
  version: number;
  builderVersion: string;
  reportingPeriod: string | null;
  computedAt: string;
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
  graph: { nodes: GraphNode[]; edges: unknown[]; cycleWarnings: string[] };
  hotspots: {
    coverageTarget: number;
    hotspotCount: number;
    cumulativeSharePctAtCut: number;
    medianIntensityTco2ePerKEur: number | null;
    nodes: HotspotNode[];
  };
}
export interface EdgeRow {
  id: string;
  fromSupplierId: string;
  fromSupplierName: string;
  toSupplierId: string | null;
  toLabel: string;
  relationship: string | null;
  tier: number | null;
}
interface SupplierOpt {
  id: string;
  name: string;
}

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export default async function CarbonTwinPage() {
  const [graphRes, edgesRes, suppliersRes] = await Promise.all([
    serverFetch<Snapshot>('/network/graph'),
    serverFetch<EdgeRow[]>('/network/edges'),
    serverFetch<{ items: SupplierOpt[] } | SupplierOpt[]>('/suppliers'),
  ]);

  const suppliers: SupplierOpt[] = Array.isArray(suppliersRes.data)
    ? suppliersRes.data
    : (suppliersRes.data?.items ?? []);
  const snap = graphRes.data ?? null;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Supply Chain — Carbon Twin</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            A rolled-up model of the supply chain&apos;s carbon: the organization&apos;s Scope 1
            &amp; 2 at the root, each supplier&apos;s attributed Scope 3 emissions rolled up through
            declared upstream links, and a Pareto ranking of the hotspots.{' '}
            <Link href="/supply-chain/carbon-twin/scenarios" style={{ color: 'var(--accent)' }}>
              Run network scenarios →
            </Link>
          </p>
        </div>
        <CarbonTwinTools
          hasSnapshot={Boolean(snap)}
          suppliers={suppliers}
          edges={edgesRes.data ?? []}
          version={snap?.version}
          traceNodes={(snap?.hotspots.nodes ?? []).map((n) => ({ id: n.id, label: n.label }))}
        />
      </div>

      {!snap && (
        <section className="card">
          <p style={{ marginTop: 0 }}>
            {graphRes.error?.message ??
              'No carbon graph has been computed yet. Add any known upstream links, then compute.'}
          </p>
        </section>
      )}

      {snap && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Stat label="Total footprint" value={`${fmt(snap.totals.totalTco2e)} tCO2e`} />
            <Stat
              label="Supplier-specific"
              value={`${snap.totals.attributedPct}%`}
              color={snap.totals.attributedPct < 50 ? 'var(--attention)' : undefined}
            />
            <Stat label="Evidence-backed" value={`${snap.totals.evidenceBackedPct}%`} />
            <Stat
              label="Suppliers"
              value={`${snap.totals.suppliers - snap.totals.unattributedSuppliers} / ${snap.totals.suppliers}`}
            />
            <Stat label="Graph depth" value={`${snap.totals.maxDepth}`} />
            <Stat
              label="Hotspots"
              value={`${snap.hotspots.hotspotCount} (→${fmt(snap.hotspots.cumulativeSharePctAtCut)}%)`}
            />
          </div>

          {snap.graph.cycleWarnings.length > 0 && (
            <section className="card" style={{ borderColor: 'var(--attention)' }}>
              <strong>Graph warnings</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
                {snap.graph.cycleWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}

          <ParetoBar nodes={snap.hotspots.nodes} />

          <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Supplier</th>
                  <th style={{ textAlign: 'right' }}>Total tCO2e</th>
                  <th style={{ textAlign: 'right' }}>Share</th>
                  <th style={{ textAlign: 'right' }}>Cumulative</th>
                  <th style={{ textAlign: 'right' }}>Intensity</th>
                  <th style={{ textAlign: 'right' }}>vs median</th>
                  <th>Why it&apos;s a hotspot</th>
                </tr>
              </thead>
              <tbody>
                {snap.hotspots.nodes.map((n) => (
                  <tr
                    key={n.id}
                    style={{
                      background: n.isHotspot ? 'var(--surface-sunken)' : undefined,
                    }}
                  >
                    <td className="muted">{n.rank}</td>
                    <td>
                      {n.id.startsWith('ext:') ? (
                        <span>{n.label}</span>
                      ) : (
                        <Link
                          href={`/supply-chain/suppliers/${n.id}`}
                          style={{ color: 'var(--accent)' }}
                        >
                          {n.label}
                        </Link>
                      )}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {n.tier != null ? `tier ${n.tier}` : 'tier —'}
                        {n.isHotspot ? ' · hotspot' : ''}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{fmt(n.totalTco2e)}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>{n.sharePct}%</td>
                    <td style={{ textAlign: 'right' }} className="muted">
                      {n.cumulativeSharePct}%
                    </td>
                    <td style={{ textAlign: 'right' }} className="mono">
                      {n.intensityTco2ePerKEur ?? '—'}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        color:
                          n.intensityVsMedian != null && n.intensityVsMedian > 1.25
                            ? 'var(--critical)'
                            : undefined,
                      }}
                    >
                      {n.intensityVsMedian == null ? '—' : `${n.intensityVsMedian}×`}
                    </td>
                    <td>
                      {n.reasons.map((r) => (
                        <span key={r} className="tag" style={{ fontSize: 11 }}>
                          {r}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <p className="mono muted" style={{ fontSize: 11, margin: 0 }}>
            {snap.builderVersion} · v{snap.version} · {snap.reportingPeriod ?? 'active period'} ·
            computed {new Date(snap.computedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card" style={{ minWidth: 140 }}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function ParetoBar({ nodes }: { nodes: HotspotNode[] }) {
  const withShare = nodes.filter((n) => n.sharePct > 0);
  if (withShare.length === 0) return null;
  return (
    <div className="card">
      <div className="label" style={{ marginBottom: 8 }}>
        Contribution to the total (Pareto)
      </div>
      <div
        style={{
          display: 'flex',
          height: 22,
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        {withShare.map((n) => (
          <span
            key={n.id}
            title={`${n.label} — ${n.sharePct}%`}
            style={{
              width: `${n.sharePct}%`,
              background: n.isHotspot ? 'var(--accent)' : 'var(--surface-sunken)',
              borderRight: '1px solid var(--bg)',
            }}
          />
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        Highlighted segments are the hotspot set — the smallest group of suppliers that together
        account for ~80% of the footprint.
      </div>
    </div>
  );
}
