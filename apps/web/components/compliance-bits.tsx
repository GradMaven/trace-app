import type { ReactNode } from 'react';

const STATUS_LABEL: Record<string, string> = {
  not_started: 'not started',
  data_available: 'data available',
  evidence_available: 'evidence available',
  mapping_complete: 'mapping complete',
  review_required: 'review required',
};

const STATUS_COLOR: Record<string, string | undefined> = {
  not_started: 'var(--text-muted)',
  data_available: 'var(--attention)',
  evidence_available: 'var(--info)',
  mapping_complete: 'var(--positive)',
  review_required: 'var(--critical)',
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span className="tag" style={{ color: STATUS_COLOR[status] }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function ReadinessBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 160,
      }}
    >
      <span
        style={{
          position: 'relative',
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            width: `${clamped}%`,
            background:
              clamped >= 66
                ? 'var(--positive)'
                : clamped >= 33
                  ? 'var(--attention)'
                  : 'var(--critical)',
          }}
        />
      </span>
      <span className="mono muted" style={{ fontSize: 12 }}>
        {clamped.toFixed(0)}%
      </span>
    </span>
  );
}

export function GapReasons({ reasons }: { reasons: string[] }) {
  if (!reasons?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {reasons.map((r) => (
        <span key={r} className="tag" style={{ fontSize: 11 }}>
          {r.replace(/_/g, ' ')}
        </span>
      ))}
    </span>
  );
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  return (
    <p
      className="notice"
      style={{ fontSize: 12, borderLeft: '3px solid var(--attention)', paddingLeft: 10 }}
    >
      {children ??
        'TRACE supports professional judgement about disclosure readiness. It does not determine compliance and does not provide legal advice. Status is objective — “compliant” is never asserted.'}
    </p>
  );
}
