import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server-api';
import { AppShell } from '@/components/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.activeSupplierId) redirect('/portal');
  if (me.memberships.length === 0) redirect('/onboarding');
  return <AppShell me={me}>{children}</AppShell>;
}
