import { serverFetch } from '@/lib/server-api';
import { ApiKeysClient } from './api-keys-client';

export const dynamic = 'force-dynamic';

export interface ApiKeyView {
  id: string;
  name: string;
  tokenPrefix: string;
  last4: string;
  scopes: string[];
  permissions: string[];
  state: 'active' | 'expired' | 'revoked';
  createdByUserId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default async function ApiKeysPage() {
  const [keysRes, scopesRes] = await Promise.all([
    serverFetch<ApiKeyView[]>('/api-keys'),
    serverFetch<Array<{ scope: string; description: string }>>('/api-keys/scopes'),
  ]);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 900 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: 0 }}>Settings — API Keys</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Keys authenticate machine-to-machine calls with the{' '}
          <span className="mono">x-api-key</span> header (or{' '}
          <span className="mono">Authorization: Bearer</span>). Each key is scoped to this
          organization and a capped permission set — a key can never manage members, roles,
          other keys, or webhooks. The full <span className="mono">trk_…</span> token is shown
          once, at creation.
        </p>
      </div>
      {keysRes.error && <p style={{ color: 'var(--critical)' }}>{keysRes.error.message}</p>}
      <ApiKeysClient keys={keysRes.data ?? []} scopes={scopesRes.data ?? []} />
    </div>
  );
}
