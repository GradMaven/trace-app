'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

export function DownloadButton({ documentId }: { documentId: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const res = await clientFetch<{ url: string }>(`/documents/${documentId}/download-url`);
    setBusy(false);
    if (res.ok && res.data) window.open(res.data.url, '_blank', 'noopener');
  }
  return (
    <button className="btn" onClick={() => void open()} disabled={busy}>
      {busy ? 'Preparing…' : 'Download'}
    </button>
  );
}

export function EvidenceActions({
  evidenceId,
  nextStates,
  status,
}: {
  evidenceId: string;
  nextStates: string[];
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [dpMetric, setDpMetric] = useState('');
  const [dpValue, setDpValue] = useState('');
  const [dpUnit, setDpUnit] = useState('');
  const [dpProvenance, setDpProvenance] = useState('supplier_reported');
  const [dpSubjectType, setDpSubjectType] = useState('organization');
  const [dpSubjectId, setDpSubjectId] = useState('');

  async function transition(to: string) {
    setBusy(to);
    setMsg(null);
    const res = await clientFetch(`/evidence/${evidenceId}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to, note: note || undefined }),
    });
    setBusy(null);
    if (res.ok) {
      setNote('');
      router.refresh();
    } else setMsg({ kind: 'err', text: res.error?.message ?? 'Transition failed.' });
  }

  async function supersede() {
    setBusy('supersede');
    const res = await clientFetch<{ id: string }>(`/evidence/${evidenceId}/supersede`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setBusy(null);
    if (res.ok && res.data) router.push(`/data/evidence/${res.data.id}`);
    else setMsg({ kind: 'err', text: res.error?.message ?? 'Could not supersede.' });
  }

  async function createAndLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy('link');
    setMsg(null);
    const body: Record<string, unknown> = {
      metricKey: dpMetric,
      provenance: dpProvenance,
      subjectType: dpSubjectType,
      subjectId: dpSubjectId,
    };
    if (dpValue) body.valueNumeric = Number(dpValue);
    else body.valueText = 'n/a';
    if (dpUnit) body.unit = dpUnit;
    const created = await clientFetch<{ id: string }>('/datapoints', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!created.ok || !created.data) {
      setBusy(null);
      setMsg({ kind: 'err', text: created.error?.message ?? 'Could not create datapoint.' });
      return;
    }
    const link = await clientFetch(`/evidence/${evidenceId}/datapoints`, {
      method: 'POST',
      body: JSON.stringify({ datapointId: created.data.id }),
    });
    setBusy(null);
    if (link.ok) {
      setShowLink(false);
      setDpMetric('');
      setDpValue('');
      setDpUnit('');
      setDpSubjectId('');
      router.refresh();
    } else setMsg({ kind: 'err', text: link.error?.message ?? 'Created, but linking failed.' });
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Move from <span className="tag">{status}</span> to:
        </span>
        {nextStates.length === 0 && <span className="muted">(terminal state)</span>}
        {nextStates
          .filter((s) => s !== 'superseded')
          .map((s) => (
            <button
              key={s}
              className={s === 'verified' ? 'btn btn-primary' : 'btn'}
              disabled={busy !== null}
              onClick={() => void transition(s)}
            >
              {busy === s ? '…' : s}
            </button>
          ))}
        <button className="btn" disabled={busy !== null} onClick={() => void supersede()}>
          {busy === 'supersede' ? '…' : 'Supersede (new version)'}
        </button>
        <button className="btn" onClick={() => setShowLink((v) => !v)}>
          Link datapoint
        </button>
      </div>

      <input
        className="input"
        placeholder="Optional note for verify / reject"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ maxWidth: 480 }}
      />

      {showLink && (
        <form onSubmit={createAndLink} style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              placeholder="metric key (e.g. scope1_tco2e)"
              required
              value={dpMetric}
              onChange={(e) => setDpMetric(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <input
              className="input"
              type="number"
              placeholder="value"
              value={dpValue}
              onChange={(e) => setDpValue(e.target.value)}
              style={{ maxWidth: 120 }}
            />
            <input
              className="input"
              placeholder="unit"
              value={dpUnit}
              onChange={(e) => setDpUnit(e.target.value)}
              style={{ maxWidth: 100 }}
            />
            <select
              className="input"
              value={dpProvenance}
              onChange={(e) => setDpProvenance(e.target.value)}
              style={{ maxWidth: 170 }}
            >
              {['measured', 'supplier_reported', 'calculated', 'estimated', 'modeled', 'inferred'].map(
                (p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, ' ')}
                  </option>
                ),
              )}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="input"
              value={dpSubjectType}
              onChange={(e) => setDpSubjectType(e.target.value)}
              style={{ maxWidth: 170 }}
            >
              {['organization', 'business_unit', 'supplier', 'facility', 'product'].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="subject id (uuid)"
              required
              value={dpSubjectId}
              onChange={(e) => setDpSubjectId(e.target.value)}
              style={{ maxWidth: 320 }}
            />
            <button className="btn btn-primary" type="submit" disabled={busy !== null}>
              {busy === 'link' ? 'Linking…' : 'Create & link'}
            </button>
          </div>
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
