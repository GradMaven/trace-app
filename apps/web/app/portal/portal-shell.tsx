'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

const LINKS = [
  { href: '/portal', label: 'Overview' },
  { href: '/portal/evidence', label: 'Evidence' },
];

export function PortalShell({
  supplierName,
  organizationName,
  userName,
  children,
}: {
  supplierName: string;
  organizationName: string;
  userName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await clientFetch('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface-raised)',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <strong>TRACE</strong>
          <span className="muted" style={{ fontSize: 13 }}>
            Supplier portal · {supplierName}
            {organizationName ? ` → ${organizationName}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {userName}
          </span>
          <button className="btn" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <div style={{ display: 'flex', gap: 4, padding: '10px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 13,
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--surface-sunken)' : undefined,
                fontWeight: active ? 600 : 400,
              }}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
      <main style={{ padding: '28px 32px', flex: 1, maxWidth: 900 }}>{children}</main>
    </div>
  );
}
