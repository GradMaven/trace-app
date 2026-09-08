'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch, clientUpload } from '@/lib/client-api';

const TYPES = [
  'supplier_report',
  'certificate',
  'epd',
  'lca',
  'audit_report',
  'utility_bill',
  'invoice',
  'contract',
  'external_dataset',
];

interface EvidenceRow {
  id: string;
  type: string;
  title: string;
  sourceUrl: string | null;
  note: string | null;
  reportingPeriod: string | null;
  verified: boolean;
  createdAt: string;
}

export function EvidenceClient({
  existing,
  error,
}: {
  existing: EvidenceRow[];
  error: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState('supplier_report');
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [reportingPeriod, setReportingPeriod] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    let documentId: string | undefined;
    const file = fileRef.current?.files?.[0];
    if (file) {
      const form = new FormData();
      form.append('file', file);
      const up = await clientUpload<{ id: string }>('/documents', form);
      if (!up.ok || !up.data) {
        setBusy(false);
        setMsg(up.error?.message ?? 'Upload failed.');
        return;
      }
      documentId = up.data.id;
    }

    const body: Record<string, unknown> = { type, title };
    if (sourceUrl) body.sourceUrl = sourceUrl;
    if (reportingPeriod) body.reportingPeriod = reportingPeriod;
    if (note) body.note = note;
    if (documentId) body.documentId = documentId;
    const res = await clientFetch('/supplier-portal/evidence', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setTitle('');
      setSourceUrl('');
      setReportingPeriod('');
      setNote('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } else setMsg(res.error?.message ?? 'Could not add evidence.');
  }

  return (
    <>
      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Add evidence</h2>
        <form onSubmit={submit}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label className="label">Type</label>
              <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label className="label">Title</label>
              <input
                className="input"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="2025 Sustainability Report"
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 120 }}>
              <label className="label">Reporting period</label>
              <input
                className="input"
                value={reportingPeriod}
                onChange={(e) => setReportingPeriod(e.target.value)}
                placeholder="FY2025"
              />
            </div>
          </div>
          <div className="field">
            <label className="label">Source URL</label>
            <input
              className="input"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="field">
            <label className="label">Note (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Document (optional — PDF, XLSX, CSV, DOCX, PNG, JPG)</label>
            <input
              ref={fileRef}
              className="input"
              type="file"
              accept=".pdf,.csv,.txt,.xlsx,.docx,.png,.jpg,.jpeg"
            />
          </div>
          {msg && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{msg}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !title}>
            {busy ? 'Adding…' : 'Add evidence'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Shared evidence ({existing.length})</h2>
        {error && <p style={{ color: 'var(--critical)' }}>{error}</p>}
        {existing.length === 0 ? (
          <p className="muted">Nothing shared yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Period</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {existing.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.sourceUrl ? (
                      <a href={e.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                        {e.title}
                      </a>
                    ) : (
                      e.title
                    )}
                  </td>
                  <td className="muted">{e.type.replace(/_/g, ' ')}</td>
                  <td className="muted">{e.reportingPeriod ?? '—'}</td>
                  <td>
                    {e.verified ? (
                      <span className="tag" style={{ color: 'var(--positive)' }}>
                        verified
                      </span>
                    ) : (
                      <span className="muted">awaiting review</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
