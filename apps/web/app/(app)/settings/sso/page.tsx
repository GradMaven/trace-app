import { serverFetch } from '@/lib/server-api';
import { SsoClient } from './sso-client';

export const dynamic = 'force-dynamic';

export interface RoleMapping {
  defaultRoles: string[];
  emailDomainRoles?: Record<string, string[]>;
  groupClaim?: string;
  groupRoles?: Record<string, string[]>;
}
export interface IdentityProviderView {
  id: string;
  protocol: string;
  enabled: boolean;
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  scopes: string;
  roleMapping: RoleMapping;
  allowedEmailDomains: string[];
  linkedMembers: number;
}
interface SsoConfigResponse {
  provider: IdentityProviderView | null;
  orgSlug: string;
  redirectUri: string;
  startUrl: string;
}
interface RoleView {
  key: string;
  name: string;
}

export default async function SsoPage() {
  const [ssoRes, rolesRes] = await Promise.all([
    serverFetch<SsoConfigResponse>('/settings/sso'),
    serverFetch<RoleView[]>('/roles'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Single Sign-On</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          OpenID Connect. Members sign in through your identity provider; new members are
          provisioned just-in-time with roles from the claim mapping. Register the redirect URI
          below at your IdP and paste in the client credentials.
        </p>
      </div>
      {ssoRes.error && <p style={{ color: 'var(--critical)' }}>{ssoRes.error.message}</p>}
      {ssoRes.data && (
        <SsoClient
          config={ssoRes.data}
          roles={(rolesRes.data ?? []).map((r) => ({ key: r.key, name: r.name }))}
        />
      )}
    </div>
  );
}
