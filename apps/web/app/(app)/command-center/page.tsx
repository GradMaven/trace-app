import Link from 'next/link';
import { serverFetch, getMe } from '@/lib/server-api';
import { RecomputeInventoryButton } from './recompute-client';

export const dynamic = 'force-dynamic';

const PERIOD = 'FY2025';

interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
}
interface Summary {
  scope1: string;
  scope2Reported: string;
  scope3: string;
  total: string;
  byCategory: Array<{ scope: string; ghgCategory: string | null; valueTco2e: string; count: number }>;
}

export default async function CommandCenterPage() {
  const me = await getMe();
  const [audit, members, summaryRes, suppliersRes] = await Promise.all([
    serverFetch<{ data: AuditEntry[] }>('/audit-log?limit=6'),
    serverFetch<unknown[]>('/members'),
    serverFetch<Summary>(`/emissions/summary?reportingPeriod=${PERIOD}`),
    serverFetch<{ data: Array<{ passportCompleteness: number | null }> }>('/suppliers?limit=200'),
  ]);
  const active = me?.memberships.find((m) => m.organization.id === me.activeOrganizationId);
  const s = summaryRes.data;
  const suppliers = suppliersRes.data?.data ?? [];
  const withPassport = suppliers.filter((x) => x.passportCompleteness != null).length;

  const scope3Sorted = (s?.byCategory ?? [])
    .filter((c) => c.scope === 'scope_3')
    .sort((a, b) => Number(b.valueTco2e) - Number(a.valueTco2e));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Command Center</h1>
          <p className="muted" style={{ marginTop: 2 }}>
            {active?.organization.legalName} · {PERIOD}
          </p>
        </div>
        <RecomputeInventoryButton period={PERIOD} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 16,
        }}
      >
        <Metric label="Scope 1" value={fmt(s?.scope1)} unit="tCO2e" />
        <Metric label="Scope 2 (reported)" value={fmt(s?.scope2Reported)} unit="tCO2e" />
        <Metric label="Scope 3" value={fmt(s?.scope3)} unit="tCO2e" />
        <Metric label="Total" value={fmt(s?.total)} unit="tCO2e" strong />
        <Metric label="Suppliers with a passport" value={`${withPassport} / ${suppliers.length}`} />
      </div>

      <div className="notice">
        Sustainability readiness, evidence gaps and audit readiness are computed in later phases
        (Trust Engine — Phase 6, Audit Workspace — Phase 8). The emissions figures above come
        straight from the calculation engine — recompute after changing activity data.
      </div>

      {scope3Sorted.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Scope 3 by category</h2>
          <table>
            <tbody>
              {scope3Sorted.map((c) => (
                <tr key={c.ghgCategory}>
                  <td>{c.ghgCategory?.replace(/^cat_(\d+)_/, '$1 · ').replace(/_/g, ' ')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{Number(c.valueTco2e).toLocaleString()}</strong> tCO2e
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            <Link href="/carbon/scope-3" style={{ color: 'var(--accent)' }}>
              Open Scope 3 →
            </Link>
          </p>
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Recent activity</h2>
        {audit.data && audit.data.data.length > 0 ? (
          <table>
            <tbody>
              {audit.data.data.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.action}</td>
                  <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No activity yet.</p>
        )}
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Members: {Array.isArray(members.data) ? members.data.length : '—'}
        </p>
      </section>
    </div>
  );
}

function fmt(v?: string): string {
  if (v === undefined) return '—';
  const n = Number(v);
  return n === 0 ? '0' : n.toLocaleString();
}

function Metric({
  label,
  value,
  unit,
  strong,
}: {
  label: string;
  value: string;
  unit?: string;
  strong?: boolean;
}) {
  return (
    <div className="card" style={strong ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>
        {value}
        {unit && value !== '—' ? <span style={{ fontSize: 13, fontWeight: 400 }}> {unit}</span> : null}
      </div>
    </div>
  );
}
