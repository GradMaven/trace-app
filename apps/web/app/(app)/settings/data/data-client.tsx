'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clientFetch } from '@/lib/client-api';
import type { ExportJobView, RetentionPolicy, RetentionRun, RetentionTarget } from './page';

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DataGovernanceClient(props: {
  exports: ExportJobView[];
  exportsError: string | null;
  targets: RetentionTarget[];
  policies: RetentionPolicy[];
  runs: RetentionRun[];
  retentionError: string | null;
}) {
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <ExportsSection exports={props.exports} error={props.exportsError} />
      <RetentionSection
        targets={props.targets}
        policies={props.policies}
        runs={props.runs}
        error={props.retentionError}
      />
    </div>
  );
}

function ExportsSection({ exports, error }: { exports: ExportJobView[]; error: string | null }) {
  const router = useRouter();
  const [period, setPeriod] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setMsg(null);
    const res = await clientFetch('/exports', {
      method: 'POST',
      body: JSON.stringify({ reportingPeriod: period || undefined }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setMsg(res.error?.message ?? 'Export failed.');
  }

  async function download(id: string) {
    const res = await clientFetch<{ url: string }>(`/exports/${id}/download`, { method: 'GET' });
    if (res.ok && res.data) window.open(res.data.url, '_blank');
    else setMsg(res.error?.message ?? 'Could not get a download link.');
  }

  return (
    <section className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ fontSize: 15, margin: 0 }}>Data exports</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            style={{ width: 120, padding: 4 }}
            placeholder="FY2025 (opt.)"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>
            {busy ? 'Building…' : 'New export'}
          </button>
        </div>
      </div>
      {(error || msg) && (
        <p style={{ color: 'var(--critical)', fontSize: 13, padding: '0 14px' }}>{error ?? msg}</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Scope</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Records</th>
            <th style={{ textAlign: 'right' }}>Size</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {exports.map((e) => (
            <tr key={e.id}>
              <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.reportingPeriod ?? 'all periods'}</td>
              <td>
                <span
                  className="tag"
                  style={{
                    color:
                      e.status === 'ready'
                        ? 'var(--positive)'
                        : e.status === 'failed'
                          ? 'var(--critical)'
                          : 'var(--muted)',
                  }}
                >
                  {e.status}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>{e.totalRecords.toLocaleString()}</td>
              <td style={{ textAlign: 'right' }} className="muted">
                {fmtBytes(e.sizeBytes)}
              </td>
              <td className="muted">
                {e.expiresAt ? new Date(e.expiresAt).toLocaleDateString() : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>
                {e.status === 'ready' && (
                  <button className="btn" onClick={() => void download(e.id)}>
                    Download
                  </button>
                )}
              </td>
            </tr>
          ))}
          {exports.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No exports yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function RetentionSection({
  targets,
  policies,
  runs,
  error,
}: {
  targets: RetentionTarget[];
  policies: RetentionPolicy[];
  runs: RetentionRun[];
  error: string | null;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});

  const byTarget = new Map(policies.map((p) => [p.target, p]));

  async function setPolicy(target: string, ageDays: number, enabled: boolean) {
    setMsg(null);
    const res = await clientFetch(`/settings/retention/${target}`, {
      method: 'PUT',
      body: JSON.stringify({ ageDays, enabled }),
    });
    if (res.ok) router.refresh();
    else setMsg(res.error?.message ?? 'Could not save policy.');
  }

  async function removePolicy(target: string) {
    const res = await clientFetch(`/settings/retention/${target}`, { method: 'DELETE' });
    if (res.ok) router.refresh();
    else setMsg(res.error?.message ?? 'Could not remove policy.');
  }

  async function run(mode: 'dry_run' | 'apply') {
    if (mode === 'apply' && !confirm('Permanently delete every row matched by an enabled policy?'))
      return;
    const res = await clientFetch('/settings/retention/run', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      router.refresh();
      setMsg(mode === 'dry_run' ? 'Dry run recorded — see the runs below.' : 'Retention applied.');
    } else {
      setMsg(res.error?.message ?? 'Run failed.');
    }
  }

  return (
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Data retention</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void run('dry_run')}>
            Dry run
          </button>
          <button
            className="btn"
            onClick={() => void run('apply')}
            style={{ color: 'var(--critical)' }}
          >
            Apply now
          </button>
        </div>
      </div>
      {(error || msg) && (
        <p style={{ color: error ? 'var(--critical)' : 'var(--positive)', fontSize: 13 }}>
          {error ?? msg}
        </p>
      )}

      <table style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Data</th>
            <th style={{ textAlign: 'right' }}>Keep for (days)</th>
            <th>Policy</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => {
            const p = byTarget.get(t.key);
            const draft = drafts[t.key] ?? p?.ageDays ?? t.min;
            return (
              <tr key={t.key}>
                <td>
                  {t.label}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {t.description}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min={t.min}
                    max={3650}
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.key]: Number(e.target.value) }))}
                    style={{ width: 80, padding: 4 }}
                  />
                  <div className="muted" style={{ fontSize: 11 }}>
                    min {t.min}
                  </div>
                </td>
                <td>
                  {p ? (
                    <span
                      className="tag"
                      style={{ color: p.enabled ? 'var(--positive)' : 'var(--muted)' }}
                    >
                      {p.enabled ? 'enabled' : 'disabled'}
                    </span>
                  ) : (
                    <span className="muted">none</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn" onClick={() => void setPolicy(t.key, draft, true)}>
                    {p ? 'Update' : 'Enable'}
                  </button>{' '}
                  {p && (
                    <button className="btn" onClick={() => void removePolicy(t.key)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {runs.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>Recent runs</h3>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>When</th>
                <th>Data</th>
                <th>Mode</th>
                <th style={{ textAlign: 'right' }}>Matched</th>
                <th style={{ textAlign: 'right' }}>Deleted</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="muted">{new Date(r.startedAt).toLocaleString()}</td>
                  <td>{r.label}</td>
                  <td>
                    <span className="tag">{r.mode}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.matched}</td>
                  <td style={{ textAlign: 'right' }}>{r.deleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
