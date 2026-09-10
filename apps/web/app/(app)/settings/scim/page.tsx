import { serverFetch } from '@/lib/server-api';
import { ScimClient } from './scim-client';

export const dynamic = 'force-dynamic';

export interface ScimConfigView {
  enabled: boolean;
  hasToken: boolean;
  tokenPrefix: string | null;
  defaultRoles: string[];
  groupRoleMapping: Record<string, string[]>;
  lastRequestAt: string | null;
  userCount: number;
  groupCount: number;
}
export interface ScimOverview {
  users: Array<{
    id: string;
    userName: string;
    email: string;
    displayName: string | null;
    active: boolean;
    roleKeys: string[];
  }>;
  groups: Array<{ id: string; displayName: string; externalId: string | null; memberCount: number }>;
}
interface ScimResponse {
  config: ScimConfigView | null;
  baseUrl: string;
  overview: ScimOverview;
}
interface RoleView {
  key: string;
  name: string;
}

export default async function ScimPage() {
  const [scimRes, rolesRes] = await Promise.all([
    serverFetch<ScimResponse>('/settings/scim'),
    serverFetch<RoleView[]>('/roles'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 900 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — SCIM provisioning</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          SCIM 2.0. Your identity provider pushes user and group lifecycle to TRACE over a
          bearer-token API. Provisioned users become workspace members; SCIM groups grant roles
          through the group → roles mapping below. Deprovisioning suspends the membership.
        </p>
      </div>
      {scimRes.error && <p style={{ color: 'var(--critical)' }}>{scimRes.error.message}</p>}
      {scimRes.data && (
        <ScimClient
          data={scimRes.data}
          roles={(rolesRes.data ?? []).map((r) => ({ key: r.key, name: r.name }))}
        />
      )}
    </div>
  );
}
