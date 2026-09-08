'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';

const SUBJECT_TYPES = ['organization', 'business_unit', 'supplier', 'facility', 'product'];
const PROVENANCE = ['measured', 'supplier_reported', 'calculated', 'estimated', 'modeled', 'inferred'];

interface Supplier {
  id: string;
  name: string;
}

export function ReviewForm({
  candidateId,
  defaultProvenance,
  defaultValue,
  defaultUnit,
}: {
  candidateId: string;
  defaultProvenance: string;
  defaultValue: string | null;
  defaultUnit: string | null;
}) {
  const router = useRouter();
  const [subjectType, setSubjectType] = useState('organization');
  const [subjectId, setSubjectId] = useState('');
  const [provenance, setProvenance] = useState(defaultProvenance);
  const [value, setValue] = useState(defaultValue ?? '');
  const [unit, setUnit] = useState(defaultUnit ?? '');
  const [note, setNote] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const me = await clientFetch<{ activeOrganizationId: string }>('/me');
      if (me.ok && me.data) {
        setOrgId(me.data.activeOrganizationId);
        setSubjectId(me.data.activeOrganizationId);
      }
      const s = await clientFetch<{ data: Supplier[] }>('/suppliers?limit=200');
      if (s.ok && s.data) setSuppliers(s.data.data);
    })();
  }, []);

  useEffect(() => {
    if (subjectType === 'organization') setSubjectId(orgId);
    else if (subjectType === 'supplier') setSubjectId(suppliers[0]?.id ?? '');
    else setSubjectId('');
  }, [subjectType, orgId, suppliers]);

  async function promote(e: React.FormEvent) {
    e.preventDefault();
    setBusy('promote');
    setError(null);
    const body: Record<string, unknown> = { subjectType, subjectId, provenance };
    if (value !== '' && !Number.isNaN(Number(value))) body.valueNumeric = Number(value);
    if (unit) body.unit = unit;
    if (note) body.note = note;
    const res = await clientFetch<{ datapointId: string }>(
      `/candidate-datapoints/${candidateId}/promote`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    setBusy(null);
    if (res.ok && res.data) router.push(`/data/datapoints/${res.data.datapointId}`);
    else setError(res.error?.message ?? 'Could not promote.');
  }

  async function reject() {
    setBusy('reject');
    setError(null);
    const res = await clientFetch(`/candidate-datapoints/${candidateId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note: note || undefined }),
    });
    setBusy(null);
    if (res.ok) router.push('/data/candidates');
    else setError(res.error?.message ?? 'Could not reject.');
  }

  return (
    <form className="card" onSubmit={promote} style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Review</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label className="label">Subject type</label>
          <select className="input" value={subjectType} onChange={(e) => setSubjectType(e.target.value)}>
            {SUBJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 2, minWidth: 220 }}>
          <label className="label">Subject</label>
          {subjectType === 'supplier' ? (
            <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : subjectType === 'organization' ? (
            <input className="input" value={subjectId} readOnly />
          ) : (
            <input
              className="input"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              placeholder="subject id (uuid)"
            />
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Value (override)</label>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Unit</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label">Provenance</label>
          <select className="input" value={provenance} onChange={(e) => setProvenance(e.target.value)}>
            {PROVENANCE.map((p) => (
              <option key={p} value={p}>
                {p.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Review note (optional)</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={busy !== null || !subjectId}>
          {busy === 'promote' ? 'Promoting…' : 'Promote to datapoint'}
        </button>
        <button className="btn" type="button" onClick={() => void reject()} disabled={busy !== null}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </form>
  );
}
