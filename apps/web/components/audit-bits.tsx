const BAND_COLOR: Record<string, string> = {
  high: 'var(--positive)',
  medium: 'var(--attention)',
  low: 'var(--critical)',
};

const SEV_COLOR: Record<string, string | undefined> = {
  critical: 'var(--critical)',
  warning: 'var(--attention)',
  info: undefined,
};

export function ScoreBadge({ value, band }: { value: number; band: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 34, fontWeight: 700, color: BAND_COLOR[band] }}>{value}</span>
      <span className="muted">/ 100</span>
      <span className="tag" style={{ color: BAND_COLOR[band] }}>
        {band}
      </span>
    </span>
  );
}

export function SeverityTag({ severity }: { severity: string }) {
  return (
    <span className="tag" style={{ color: SEV_COLOR[severity] }}>
      {severity}
    </span>
  );
}

export function YesNo({
  value,
  goodWhenTrue = true,
}: {
  value: boolean | null;
  goodWhenTrue?: boolean;
}) {
  if (value == null) return <span className="muted">n/a</span>;
  const good = value === goodWhenTrue;
  return (
    <span style={{ color: good ? 'var(--positive)' : 'var(--critical)' }}>
      {value ? 'yes' : 'no'}
    </span>
  );
}
