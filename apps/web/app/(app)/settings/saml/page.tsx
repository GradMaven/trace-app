import { serverFetch } from '@/lib/server-api';
import { SamlClient } from './saml-client';

export const dynamic = 'force-dynamic';

export interface SamlRoleMapping {
  defaultRoles: string[];
  emailDomainRoles?: Record<string, string[]>;
  groupClaim?: string;
  groupRoles?: Record<string, string[]>;
}
export interface SamlProviderView {
  id: string;
  enabled: boolean;
  idpEntityId: string;
  ssoUrl: string;
  certificates: string[];
  emailAttribute: string | null;
  nameAttribute: string | null;
  groupsAttribute: string | null;
  wantAssertionsSigned: boolean;
  roleMapping: SamlRoleMapping;
  allowedEmailDomains: string[];
  linkedMembers: number;
}
interface SamlConfigResponse {
  provider: SamlProviderView | null;
  orgSlug: string;
  acsUrl: string;
  startUrl: string;
  spEntityId: string;
  metadataUrl: string;
}
interface RoleView {
  key: string;
  name: string;
}

export default async function SamlPage() {
  const [samlRes, rolesRes] = await Promise.all([
    serverFetch<SamlConfigResponse>('/settings/saml'),
    serverFetch<RoleView[]>('/roles'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 860 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — SAML single sign-on</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          SAML 2.0 Web-Browser-SSO (HTTP-POST assertion). Members sign in through your identity
          provider; new members are provisioned just-in-time with roles from the attribute
          mapping. Register the ACS URL and SP entity ID below at your IdP and paste in its
          signing certificate.
        </p>
      </div>
      {samlRes.error && <p style={{ color: 'var(--critical)' }}>{samlRes.error.message}</p>}
      {samlRes.data && (
        <SamlClient
          config={samlRes.data}
          roles={(rolesRes.data ?? []).map((r) => ({ key: r.key, name: r.name }))}
        />
      )}
    </div>
  );
}
