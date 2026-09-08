'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

interface Props {
  supplierId: string;
  hasRelationship: boolean;
  hasOpenRequest: boolean;
  submittedRequestId: string | null;
  relationship: {
    category: string | null;
    tier: number | null;
    annualSpend: string | null;
    currency: string | null;
  } | null;
}

export function SupplierActions({
  supplierId,
  hasOpenRequest,
  submittedRequestId,
  relationship,
}: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [showRel, setShowRel] = useState(false);
  const [category, setCategory] = useState(relationship?.category ?? '');
  const [tier, setTier] = useState(relationship?.tier?.toString() ?? '');
  const [spend, setSpend] = useState(relationship?.annualSpend ?? '');

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    await run('invite', async () => {
      const res = await clientFetch(`/suppliers/${supplierId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail }),
      });
      if (res.ok) {
        setInviteEmail('');
        setMsg({ kind: 'ok', text: 'Invitation sent (magic link printed in the API log).' });
        router.refresh();
      } else setMsg({ kind: 'err', text: res.error?.message ?? 'Failed.' });
    });
  }

  async function sendQuestionnaire() {
    await run('send', async () => {
      const res = await clientFetch(`/suppliers/${supplierId}/requests`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setMsg({ kind: 'ok', text: 'Sustainability questionnaire sent.' });
        router.refresh();
      } else setMsg({ kind: 'err', text: res.error?.message ?? 'Failed.' });
    });
  }

  async function recompute() {
    await run('recompute', async () => {
      const res = await clientFetch(`/suppliers/${supplierId}/passport/recompute`, { method: 'POST' });
      if (res.ok) {
        setMsg({ kind: 'ok', text: 'Passport recomputed.' });
        router.refresh();
      } else setMsg({ kind: 'err', text: res.error?.message ?? 'Failed.' });
    });
  }

  async function acceptRequest() {
    if (!submittedRequestId) return;
    await run('accept', async () => {
      const res = await clientFetch(`/supplier-requests/${submittedRequestId}/accept`, {
        method: 'POST',
      });
      if (res.ok) {
        setMsg({ kind: 'ok', text: 'Questionnaire accepted; passport updated.' });
        router.refresh();
      } else setMsg({ kind: 'err', text: res.error?.message ?? 'Failed.' });
    });
  }

  async function saveRelationship(e: React.FormEvent) {
    e.preventDefault();
    await run('rel', async () => {
      const body: Record<string, unknown> = {};
      if (category) body.category = category;
      if (tier) body.tier = Number(tier);
      if (spend) body.annualSpend = Number(spend);
      const res = await clientFetch(`/suppliers/${supplierId}/relationship`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowRel(false);
        setMsg({ kind: 'ok', text: 'Relationship saved.' });
        router.refresh();
      } else setMsg({ kind: 'err', text: res.error?.message ?? 'Failed.' });
    });
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          disabled={busy !== null || hasOpenRequest}
          onClick={() => void sendQuestionnaire()}
          title={hasOpenRequest ? 'A questionnaire is already open' : undefined}
        >
          {busy === 'send' ? 'Sending…' : 'Send sustainability questionnaire'}
        </button>
        {submittedRequestId && (
          <button className="btn" disabled={busy !== null} onClick={() => void acceptRequest()}>
            {busy === 'accept' ? 'Accepting…' : 'Accept submitted questionnaire'}
          </button>
        )}
        <button className="btn" disabled={busy !== null} onClick={() => void recompute()}>
          {busy === 'recompute' ? 'Working…' : 'Recompute passport'}
        </button>
        <button className="btn" onClick={() => setShowRel((v) => !v)}>
          {relationship ? 'Edit relationship' : 'Add relationship'}
        </button>
      </div>

      <form onSubmit={invite} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input"
          type="email"
          placeholder="supplier.contact@company.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <button className="btn" type="submit" disabled={busy !== null || !inviteEmail}>
          {busy === 'invite' ? 'Inviting…' : 'Invite supplier user'}
        </button>
      </form>

      {showRel && (
        <form onSubmit={saveRelationship} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <input
            className="input"
            type="number"
            min={1}
            max={10}
            placeholder="Tier"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            style={{ maxWidth: 90 }}
          />
          <input
            className="input"
            type="number"
            min={0}
            placeholder="Annual spend €"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            style={{ maxWidth: 160 }}
          />
          <button className="btn btn-primary" type="submit" disabled={busy !== null}>
            Save
          </button>
        </form>
      )}

      {msg && (
        <p style={{ margin: 0, fontSize: 13, color: msg.kind === 'ok' ? 'var(--positive)' : 'var(--critical)' }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
