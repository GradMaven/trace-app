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
  'erp_record',
  'logistics_record',
  'external_dataset',
  'questionnaire',
];

export function AddEvidence() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('supplier_report');
  const [title, setTitle] = useState('');
  const [reportingPeriod, setReportingPeriod] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let documentId: string | undefined;
      const file = fileRef.current?.files?.[0];
      if (file) {
        const form = new FormData();
        form.append('file', file);
        const up = await clientUpload<{ id: string }>('/documents', form);
        if (!up.ok || !up.data) {
          setError(up.error?.message ?? 'Upload failed.');
          setBusy(false);
          return;
        }
        documentId = up.data.id;
      }
      const body: Record<string, unknown> = { type, title };
      if (reportingPeriod) body.reportingPeriod = reportingPeriod;
      if (sourceUrl) body.sourceUrl = sourceUrl;
      if (documentId) body.documentId = documentId;
      const res = await clientFetch<{ id: string }>('/evidence', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setBusy(false);
      if (res.ok && res.data) router.push(`/data/evidence/${res.data.id}`);
      else setError(res.error?.message ?? 'Could not create evidence.');
    } catch {
      setBusy(false);
      setError('Something went wrong.');
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Add evidence
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '8vh',
        zIndex: 50,
      }}
      onClick={() => setOpen(false)}
    >
      <form
        className="card"
        style={{ width: 480, maxWidth: '92vw' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Add evidence</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
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
          <label className="label">Title</label>
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Source URL (optional)</label>
          <input
            className="input"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
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
        {error && <p style={{ color: 'var(--critical)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !title}>
            {busy ? 'Saving…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
