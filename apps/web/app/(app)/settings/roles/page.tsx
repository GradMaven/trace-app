import { serverFetch } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

export default async function RolesPage() {
  const roles = await serverFetch<RoleView[]>('/roles');

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Roles</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Permission-based access control. Each role grants a set of permission keys.
      </p>
      {roles.error && <p style={{ color: 'var(--critical)' }}>{roles.error.message}</p>}
      <div style={{ display: 'grid', gap: 14 }}>
        {(roles.data ?? []).map((r) => (
          <div key={r.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <strong>{r.name}</strong>{' '}
                <span className="mono muted">{r.key}</span>
                <p className="muted" style={{ margin: '4px 0 0' }}>
                  {r.description}
                </p>
              </div>
              <span className="tag">{r.permissions.length} permissions</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {r.permissions.map((p) => (
                <span key={p} className="mono tag">
                  {p}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
