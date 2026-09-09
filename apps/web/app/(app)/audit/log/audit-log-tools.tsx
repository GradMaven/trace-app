'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE } from '@/lib/api';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

export function AuditLogTools({ action }: { action: string }) {
  const router = useRouter();
  const [value, setValue] = useState(action);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function applyFilter(e: React.FormEvent) {
    e.preventDefault();
    const qs = value.trim() ? `?action=${encodeURIComponent(value.trim())}` : '';
    router.push(`/audit/log${qs}`);
  }

  async function exportNdjson() {
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (value.trim()) qs.set('action', value.trim());
      const orgId = readCookie('trace_active_org');
      const res = await fetch(`${API_BASE}/audit-log/export?${qs}`, {
        credentials: 'include',
        headers: orgId ? { 'x-organization-id': orgId } : {},
      });
      if (!res.ok) {
        setErr(`Export failed (${res.status}).`);
        return;
      }
      const text = await res.text();
      const rows = res.headers.get('x-trace-rows') ?? '?';
      const blob = new Blob([text], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trace-audit-log-${new Date().toISOString().slice(0, 10)}.ndjson`;
      a.click();
      URL.revokeObjectURL(url);
      setErr(`Downloaded ${rows} entries.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={applyFilter}
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexWrap: 'wrap',
        margin: '10px 0 14px',
      }}
    >
      <input
        className="input"
        style={{ width: 240, padding: 4 }}
        placeholder="filter by action prefix, e.g. evidence."
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="btn" type="submit">
        Filter
      </button>
      {value && (
        <button
          className="btn"
          type="button"
          onClick={() => {
            setValue('');
            router.push('/audit/log');
          }}
        >
          Clear
        </button>
      )}
      <button className="btn" type="button" onClick={() => void exportNdjson()} disabled={busy}>
        {busy ? 'Exporting…' : 'Export NDJSON'}
      </button>
      {err && (
        <span className="muted" style={{ fontSize: 12 }}>
          {err}
        </span>
      )}
    </form>
  );
}
