import { serverFetch, getMe } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
}

export default async function CommandCenterPage() {
  const me = await getMe();
  const audit = await serverFetch<{ data: AuditEntry[] }>('/audit-log?limit=5');
  const members = await serverFetch<unknown[]>('/members');
  const active = me?.memberships.find((m) => m.organization.id === me.activeOrganizationId);

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Command Center</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {active?.organization.legalName}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          margin: '20px 0',
        }}
      >
        <Metric label="Members" value={Array.isArray(members.data) ? String(members.data.length) : '—'} />
        <Metric label="Your permissions" value={String(me?.permissions.length ?? 0)} />
        <Metric label="Audit entries (recent)" value={String(audit.data?.data.length ?? 0)} />
      </div>

      <div className="notice" style={{ marginBottom: 20 }}>
        Sustainability readiness, evidence gaps, and Scope 3 hotspots are computed from real model
        data in later phases (Trust Engine — Phase 6, Audit Workspace — Phase 8, Command Center —
        Phase 9). Nothing on this screen is a fabricated metric.
      </div>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Recent activity</h2>
        {audit.ok && audit.data && audit.data.data.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>When</th>
              </tr>
            </thead>
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
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}
