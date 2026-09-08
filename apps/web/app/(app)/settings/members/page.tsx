import { serverFetch } from '@/lib/server-api';
import { MembersClient } from './members-client';

export const dynamic = 'force-dynamic';

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  status: string;
  roleKeys: string[];
  joinedAt: string;
}
export interface InvitationView {
  id: string;
  email: string;
  roleKeys: string[];
  status: string;
  createdAt: string;
  expiresAt: string;
}
interface RoleView {
  key: string;
  name: string;
}

export default async function MembersPage() {
  const [members, invitations, roles] = await Promise.all([
    serverFetch<MemberView[]>('/members'),
    serverFetch<InvitationView[]>('/members/invitations'),
    serverFetch<RoleView[]>('/roles'),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Members</h1>
      <MembersClient
        members={members.data ?? []}
        invitations={invitations.data ?? []}
        roles={(roles.data ?? []).map((r) => ({ key: r.key, name: r.name }))}
        error={members.error?.message ?? roles.error?.message ?? null}
      />
    </div>
  );
}
