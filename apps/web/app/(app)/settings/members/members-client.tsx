'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { InvitationView, MemberView } from './page';

export function MembersClient({
  members,
  invitations,
  roles,
  error,
}: {
  members: MemberView[];
  invitations: InvitationView[];
  roles: Array<{ key: string; name: string }>;
  error: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await clientFetch('/members/invitations', {
      method: 'POST',
      body: JSON.stringify({ email, roleKeys: selectedRoles }),
    });
    setBusy(false);
    if (res.ok) {
      setEmail('');
      setSelectedRoles([]);
      router.refresh();
    } else {
      setMsg(res.error?.message ?? 'Could not send the invitation.');
    }
  }

  async function revoke(id: string) {
    const res = await clientFetch(`/members/invitations/${id}/revoke`, { method: 'POST' });
    if (res.ok) router.refresh();
    else setMsg(res.error?.message ?? 'Could not revoke.');
  }

  const pending = invitations.filter((i) => i.status === 'pending');

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {error && <p style={{ color: 'var(--critical)' }}>{error}</p>}

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Invite a member</h2>
        <form onSubmit={invite}>
          <div className="field">
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
          </div>
          <div className="field">
            <label className="label">Roles</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {roles.map((r) => {
                const on = selectedRoles.includes(r.key);
                return (
                  <button
                    type="button"
                    key={r.key}
                    className="tag"
                    onClick={() =>
                      setSelectedRoles((s) =>
                        on ? s.filter((k) => k !== r.key) : [...s, r.key],
                      )
                    }
                    style={{
                      cursor: 'pointer',
                      background: on ? 'var(--accent)' : 'transparent',
                      color: on ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                      borderColor: on ? 'var(--accent)' : 'var(--border)',
                    }}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
          {msg && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{msg}</p>}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !email || selectedRoles.length === 0}
          >
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Members ({members.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Roles</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.userId} member={m} roles={roles} onSaved={() => router.refresh()} />
            ))}
          </tbody>
        </table>
      </section>

      {pending.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Pending invitations ({pending.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Roles</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.roleKeys.join(', ')}</td>
                  <td className="muted">{new Date(i.expiresAt).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn" onClick={() => void revoke(i.id)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function MemberRow({
  member,
  roles,
  onSaved,
}: {
  member: MemberView;
  roles: Array<{ key: string; name: string }>;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<string[]>(member.roleKeys);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await clientFetch(`/members/${member.userId}/roles`, {
      method: 'PUT',
      body: JSON.stringify({ roleKeys: sel }),
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      onSaved();
    } else {
      setErr(res.error?.message ?? 'Could not update roles.');
    }
  }

  return (
    <tr>
      <td>{member.name}</td>
      <td className="muted">{member.email}</td>
      <td>
        {editing ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {roles.map((r) => {
              const on = sel.includes(r.key);
              return (
                <button
                  type="button"
                  key={r.key}
                  className="tag"
                  onClick={() => setSel((s) => (on ? s.filter((k) => k !== r.key) : [...s, r.key]))}
                  style={{
                    cursor: 'pointer',
                    background: on ? 'var(--accent)' : 'transparent',
                    color: on ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  {r.key}
                </button>
              );
            })}
            {err && <span style={{ color: 'var(--critical)', fontSize: 12 }}>{err}</span>}
          </div>
        ) : (
          member.roleKeys.join(', ') || '—'
        )}
      </td>
      <td>
        <span className="tag">{member.status}</span>
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {editing ? (
          <>
            <button className="btn" disabled={busy || sel.length === 0} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>{' '}
            <button
              className="btn"
              onClick={() => {
                setSel(member.roleKeys);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit roles
          </button>
        )}
      </td>
    </tr>
  );
}
