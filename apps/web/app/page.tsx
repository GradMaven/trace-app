import { redirect } from 'next/navigation';
import { getMe } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default async function IndexPage() {
  const me = await getMe();
  if (!me) redirect('/login');
  if (me.activeSupplierId) redirect('/portal');
  if (me.memberships.length === 0) redirect('/onboarding');
  redirect('/command-center');
}
