import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server-api';
import { PortalShell } from './portal-shell';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');
  if (!me.activeSupplierId) redirect('/');
  const membership = me.memberships.find((m) => m.supplier?.id === me.activeSupplierId);
  return (
    <PortalShell
      supplierName={membership?.supplier?.name ?? 'Supplier'}
      organizationName={membership?.organization.legalName ?? ''}
      userName={me.user.name}
    >
      {children}
    </PortalShell>
  );
}
