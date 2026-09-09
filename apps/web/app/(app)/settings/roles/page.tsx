import { serverFetch } from '@/lib/server-api';
import { RolesClient } from './roles-client';

export const dynamic = 'force-dynamic';

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
}

export default async function RolesPage() {
  const [rolesRes, catalogRes] = await Promise.all([
    serverFetch<RoleView[]>('/roles'),
    serverFetch<Array<{ key: string; description: string }>>('/roles/permissions'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 960 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Roles</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Access is permission-based. The eight built-in roles cannot be edited; add custom
          roles for your own responsibilities and assign them to members on the{' '}
          <span className="mono">Members</span> screen.
        </p>
      </div>
      {rolesRes.error && <p style={{ color: 'var(--critical)' }}>{rolesRes.error.message}</p>}
      <RolesClient roles={rolesRes.data ?? []} catalog={catalogRes.data ?? []} />
    </div>
  );
}
