'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clientUpload } from '@/lib/client-api';

interface TargetField {
  key: string;
  label: string;
  required: boolean;
  kind: string;
  enum?: string[];
  hint?: string;
}

interface PreviewRow {
  line: number;
  raw: Record<string, string>;
  mapped: Record<string, unknown> | null;
  errors: string[];
}

interface Preview {
  headers: string[];
  rows: PreviewRow[];
  summary: { total: number; valid: number; invalid: number };
}

interface CommitResult {
  runId: string;
  status: string;
  rowsImported: number;
  rowsTotal: number;
  rowsInvalid: number;
}

type Cell = { column?: string; constant?: string };

const SUBJECT_TYPES = ['organization', 'business_unit', 'supplier', 'facility', 'product'];

function autoMap(fields: TargetField[], headers: string[]): Record<string, Cell> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const map: Record<string, Cell> = {};
  for (const f of fields) {
    const hit =
      byNorm.get(norm(f.key)) ??
      byNorm.get(norm(f.label)) ??
      (f.key === 'reportingPeriod' ? byNorm.get('period') : undefined) ??
      (f.key === 'subjectId' ? (byNorm.get('subjectid') ?? byNorm.get('subject')) : undefined);
    if (hit) map[f.key] = { column: hit };
  }
  return map;
}

export function ImportWizard({ targetFields }: { targetFields: TargetField[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, Cell>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'commit'>(null);
  const [err, setErr] = useState<string | null>(null);

  function form(): FormData {
    const fd = new FormData();
    fd.set('file', file!);
    fd.set('kind', 'csv_activity');
    fd.set('mapping', JSON.stringify(mapping));
    fd.set('defaults', JSON.stringify(defaults));
    return fd;
  }

  async function runPreview(
    nextMapping?: Record<string, Cell>,
    nextDefaults?: Record<string, string>,
  ) {
    if (!file) return;
    setBusy('preview');
    setErr(null);
    setResult(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('kind', 'csv_activity');
    fd.set('mapping', JSON.stringify(nextMapping ?? mapping));
    fd.set('defaults', JSON.stringify(nextDefaults ?? defaults));
    const res = await clientUpload<Preview>('/integrations/imports/preview', fd);
    setBusy(null);
    if (res.ok && res.data) setPreview(res.data);
    else setErr(res.error?.message ?? 'Preview failed.');
  }

  async function onFile(f: File) {
    setFile(f);
    setResult(null);
    // Peek headers with a first preview using an auto mapping.
    const fd = new FormData();
    fd.set('file', f);
    fd.set('kind', 'csv_activity');
    fd.set('mapping', '{}');
    fd.set('defaults', '{}');
    setBusy('preview');
    const res = await clientUpload<Preview>('/integrations/imports/preview', fd);
    setBusy(null);
    if (res.ok && res.data) {
      const m = autoMap(targetFields, res.data.headers);
      setMapping(m);
      const fd2 = new FormData();
      fd2.set('file', f);
      fd2.set('kind', 'csv_activity');
      fd2.set('mapping', JSON.stringify(m));
      fd2.set('defaults', '{}');
      const res2 = await clientUpload<Preview>('/integrations/imports/preview', fd2);
      setPreview(res2.ok ? (res2.data ?? res.data) : res.data);
    } else setErr(res.error?.message ?? 'Could not read the file.');
  }

  async function commit() {
    setBusy('commit');
    setErr(null);
    const res = await clientUpload<CommitResult>('/integrations/imports/commit', form());
    setBusy(null);
    if (res.ok && res.data) {
      setResult(res.data);
      router.refresh();
    } else setErr(res.error?.message ?? 'Import failed.');
  }

  const headers = preview?.headers ?? [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="label">1 · Upload CSV / TSV</div>
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
          style={{ marginTop: 6 }}
        />
        {file && (
          <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
            {file.name}
          </span>
        )}
      </div>

      {err && <p style={{ color: 'var(--critical)' }}>{err}</p>}

      {preview && (
        <>
          <div className="card">
            <div className="label">2 · Map columns → TRACE fields</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Detected columns: {headers.join(', ') || '(none)'}
            </p>
            <table style={{ width: '100%' }}>
              <tbody>
                {targetFields.map((f) => {
                  const cell = mapping[f.key] ?? {};
                  return (
                    <tr key={f.key}>
                      <td style={{ width: 220 }}>
                        {f.label}
                        {f.required && <span style={{ color: 'var(--critical)' }}> *</span>}
                        {f.hint && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {f.hint}
                          </div>
                        )}
                      </td>
                      <td>
                        <select
                          value={cell.constant != null ? '__const__' : (cell.column ?? '')}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMapping({
                              ...mapping,
                              [f.key]:
                                v === '__const__'
                                  ? { constant: cell.constant ?? '' }
                                  : v
                                    ? { column: v }
                                    : {},
                            });
                          }}
                          style={{ padding: 4 }}
                        >
                          <option value="">— use default —</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                          <option value="__const__">— constant value —</option>
                        </select>
                        {cell.constant != null && (
                          <input
                            value={cell.constant}
                            placeholder={f.enum ? f.enum.join(' | ') : 'constant'}
                            onChange={(e) =>
                              setMapping({ ...mapping, [f.key]: { constant: e.target.value } })
                            }
                            style={{ marginLeft: 8, padding: 4, width: 200 }}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="label">3 · Defaults for anything unmapped</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
              <label style={{ fontSize: 13 }}>
                Reporting period{' '}
                <input
                  value={defaults.reportingPeriod ?? ''}
                  placeholder="FY2025"
                  onChange={(e) => setDefaults({ ...defaults, reportingPeriod: e.target.value })}
                  style={{ padding: 4, width: 110 }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Subject type{' '}
                <select
                  value={defaults.subjectType ?? ''}
                  onChange={(e) => setDefaults({ ...defaults, subjectType: e.target.value })}
                  style={{ padding: 4 }}
                >
                  <option value="">—</option>
                  {SUBJECT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                Subject id{' '}
                <input
                  value={defaults.subjectId ?? ''}
                  placeholder="UUID"
                  onChange={(e) => setDefaults({ ...defaults, subjectId: e.target.value })}
                  style={{ padding: 4, width: 300 }}
                />
              </label>
            </div>
            <button
              className="btn"
              style={{ marginTop: 10 }}
              disabled={busy !== null}
              onClick={() => void runPreview()}
            >
              {busy === 'preview' ? 'Validating…' : 'Re-validate'}
            </button>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '12px 14px', display: 'flex', gap: 16, alignItems: 'baseline' }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>4 · Preview</h2>
              <span className="muted" style={{ fontSize: 13 }}>
                {preview.summary.total} rows ·{' '}
                <span style={{ color: 'var(--positive)' }}>{preview.summary.valid} valid</span> ·{' '}
                <span style={{ color: 'var(--critical)' }}>{preview.summary.invalid} invalid</span>
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Scope</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th>Unit</th>
                  <th>Period</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((r) => {
                  const m = (r.mapped ?? {}) as Record<string, unknown>;
                  return (
                    <tr
                      key={r.line}
                      style={
                        r.errors.length
                          ? { background: 'color-mix(in srgb, var(--critical) 8%, transparent)' }
                          : undefined
                      }
                    >
                      <td className="muted">{r.line}</td>
                      <td>{String(m.scope ?? r.raw[mapping.scope?.column ?? ''] ?? '—')}</td>
                      <td>{String(m.category ?? '—')}</td>
                      <td style={{ textAlign: 'right' }}>
                        {m.value != null ? String(m.value) : '—'}
                      </td>
                      <td>{String(m.unit ?? '—')}</td>
                      <td>{String(m.reportingPeriod ?? '—')}</td>
                      <td style={{ color: 'var(--critical)', fontSize: 12 }}>
                        {r.errors.join('; ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              className="btn"
              disabled={busy !== null || preview.summary.valid === 0}
              onClick={() => void commit()}
            >
              {busy === 'commit'
                ? 'Importing…'
                : `Import ${preview.summary.valid} valid row(s) as activity data`}
            </button>
            {result && (
              <span className="muted" style={{ fontSize: 13 }}>
                {result.status} — imported {result.rowsImported} of {result.rowsTotal}.{' '}
                <Link href="/settings/integrations" style={{ color: 'var(--accent)' }}>
                  View runs →
                </Link>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
