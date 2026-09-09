import { serverFetch } from '@/lib/server-api';
import { SecurityClient } from './security-client';

export const dynamic = 'force-dynamic';

export interface MfaStatus {
  enrolled: boolean;
  pending: boolean;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
  lastUsedAt: string | null;
  orgMandates: boolean;
}

export interface OrgSecurity {
  requireMfa: boolean;
  legalHold: boolean;
  members: number;
  membersWithMfa: number;
}

export default async function SecurityPage() {
  const [mfaRes, orgRes] = await Promise.all([
    serverFetch<MfaStatus>('/me/mfa'),
    serverFetch<OrgSecurity>('/settings/security'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 720 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — Security</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Two-factor authentication for your account, and — if you administer this organization —
          MFA enforcement and legal hold.
        </p>
      </div>
      <SecurityClient
        mfa={mfaRes.data ?? null}
        mfaError={mfaRes.error?.message ?? null}
        org={orgRes.ok ? (orgRes.data ?? null) : null}
      />
    </div>
  );
}
