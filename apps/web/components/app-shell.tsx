'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { NAV } from '@/lib/nav';
import { clientFetch } from '@/lib/client-api';
import type { Me } from '@/lib/server-api';

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = me.memberships.find((m) => m.organization.id === me.activeOrganizationId) ?? me.memberships[0];

  async function switchOrg(id: string) {
    document.cookie = `trace_active_org=${id}; path=/; max-age=31536000; samesite=lax`;
    await clientFetch('/auth/switch-organization', {
      method: 'POST',
      body: JSON.stringify({ organizationId: id }),
    });
    router.refresh();
  }

  async function logout() {
    await clientFetch('/auth/logout', { method: 'POST' });
    document.cookie = 'trace_active_org=; path=/; max-age=0';
    router.replace('/login');
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px 1fr', minHeight: '100vh' }}>
      <aside
        style={{
          borderRight: '1px solid var(--border-subtle)',
          background: 'var(--surface-raised)',
          padding: '18px 14px',
          overflowY: 'auto',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, padding: '4px 8px 14px' }}>TRACE</div>
        {NAV.map((section, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            {section.label && (
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                  padding: '6px 8px',
                }}
              >
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return item.ready ? (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'block',
                    padding: '7px 8px',
                    borderRadius: 6,
                    fontSize: 13,
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                    background: isActive ? 'var(--surface-sunken)' : undefined,
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.href}
                  title="Arrives in a later phase"
                  style={{
                    display: 'block',
                    padding: '7px 8px',
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    opacity: 0.55,
                    cursor: 'not-allowed',
                  }}
                >
                  {item.label}
                </span>
              );
            })}
          </div>
        ))}
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--surface-raised)',
          }}
        >
          <select
            value={active?.organization.id}
            onChange={(e) => void switchOrg(e.target.value)}
            className="input"
            style={{ width: 'auto', minWidth: 220 }}
          >
            {me.memberships.map((m) => (
              <option key={m.organization.id} value={m.organization.id}>
                {m.organization.legalName}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {me.user.name} · {active?.roles.map((r) => r.name).join(', ')}
            </span>
            <button className="btn" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </header>
        <main style={{ padding: '28px 32px', flex: 1 }}>{children}</main>
      </div>
    </div>
  );
}
