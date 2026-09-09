'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { RoleView } from './page';

type Catalog = Array<{ key: string; description: string }>;

export function RolesClient({ roles, catalog }: { roles: RoleView[]; catalog: Catalog }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const custom = roles.filter((r) => !r.isSystem);
  const system = roles.filter((r) => r.isSystem);

  async function del(id: string) {
    if (!confirm('Delete this custom role?')) return;
    const res = await clientFetch(`/roles/${id}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
    else setErr(res.error?.message ?? 'Could not delete.');
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {err && <p style={{ color: 'var(--critical)' }}>{err}</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Custom roles ({custom.length})</h2>
        {editing !== 'new' && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            New role
          </button>
        )}
      </div>

      {editing === 'new' && (
        <RoleForm
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {custom.map((r) =>
        editing === r.id ? (
          <RoleForm
            key={r.id}
            role={r}
            catalog={catalog}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : (
          <RoleCard
            key={r.id}
            role={r}
            onEdit={() => setEditing(r.id)}
            onDelete={() => void del(r.id)}
          />
        ),
      )}
      {custom.length === 0 && editing !== 'new' && (
        <p className="muted">No custom roles yet.</p>
      )}

      <h2 style={{ fontSize: 15, margin: '8px 0 0' }}>Built-in roles</h2>
      {system.map((r) => (
        <RoleCard key={r.id} role={r} />
      ))}
    </div>
  );
}

function RoleCard({
  role,
  onEdit,
  onDelete,
}: {
  role: RoleView;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong>{role.name}</strong> <span className="mono muted">{role.key}</span>
          {role.description && (
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {role.description}
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <span className="tag">{role.permissions.length} perms</span>{' '}
          <span className="tag">{role.memberCount} members</span>
          {onEdit && (
            <>
              {' '}
              <button className="btn" onClick={onEdit}>
                Edit
              </button>
            </>
          )}
          {onDelete && role.memberCount === 0 && (
            <>
              {' '}
              <button className="btn" onClick={onDelete}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {role.permissions.map((p) => (
          <span key={p} className="mono tag">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

function RoleForm({
  role,
  catalog,
  onClose,
  onSaved,
}: {
  role?: RoleView;
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(role?.key ?? '');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Catalog>();
    for (const c of catalog) {
      const g = c.key.split('.')[0] ?? 'other';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);

  function toggle(p: string) {
    setPerms((v) => (v.includes(p) ? v.filter((x) => x !== p) : [...v, p]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = role
      ? await clientFetch(`/roles/${role.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, description, permissions: perms }),
        })
      : await clientFetch('/roles', {
          method: 'POST',
          body: JSON.stringify({ key, name, description: description || undefined, permissions: perms }),
        });
    setBusy(false);
    if (res.ok) onSaved();
    else setErr(res.error?.message ?? 'Could not save the role.');
  }

  return (
    <form className="card" onSubmit={save}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>{role ? `Edit ${role.name}` : 'New custom role'}</h2>
      {!role && (
        <div className="field">
          <label className="label">Key</label>
          <input
            className="input mono"
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="data_steward"
          />
        </div>
      )}
      <div className="field">
        <label className="label">Name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label className="label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label className="label">Permissions ({perms.length})</label>
        <div style={{ display: 'grid', gap: 12, maxHeight: 320, overflowY: 'auto' }}>
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="mono muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                {group}
              </div>
              <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                {items.map((c) => (
                  <label key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
                    <input type="checkbox" checked={perms.includes(c.key)} onChange={() => toggle(c.key)} />
                    <span className="mono">{c.key}</span>
                    <span className="muted">— {c.description}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {err && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !name || perms.length === 0 || (!role && !key)}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
