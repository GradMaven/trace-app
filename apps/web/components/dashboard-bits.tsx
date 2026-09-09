import Link from 'next/link';

const BAND_COLOR: Record<string, string> = {
  high: 'var(--positive)',
  medium: 'var(--attention)',
  low: 'var(--critical)',
};

export function bandFor(value: number | null): string {
  if (value == null) return 'medium';
  if (value >= 75) return 'high';
  if (value >= 50) return 'medium';
  return 'low';
}

/** A big band-coloured 0–100 number with a thin progress track. */
export function Gauge({
  label,
  value,
  suffix = '/ 100',
  band,
  href,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  band?: string;
  href?: string;
}) {
  const b = band ?? bandFor(value);
  const inner = (
    <div className="card" style={{ minWidth: 150 }}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: BAND_COLOR[b], marginTop: 2 }}>
        {value == null ? '—' : Math.round(value)}
        <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
          {' '}
          {suffix}
        </span>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: 'var(--surface-sunken)',
          overflow: 'hidden',
          marginTop: 6,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.max(0, Math.min(100, value ?? 0))}%`,
            background: BAND_COLOR[b],
          }}
        />
      </div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** A tiny inline SVG line chart. */
export function Sparkline({
  points,
  width = 240,
  height = 48,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - ((p - min) / span) * (height - 6) - 3).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend"
    >
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={height - ((p - min) / span) * (height - 6) - 3}
          r={2.5}
          fill="var(--accent)"
        />
      ))}
    </svg>
  );
}

/** A horizontal stacked bar from labelled segments. */
export function StackBar({
  segments,
  height = 14,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  height?: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          height,
          borderRadius: 4,
          overflow: 'hidden',
          background: 'var(--surface-sunken)',
        }}
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.label}
              title={`${s.label}: ${s.value}`}
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            />
          ))}
      </div>
      <div
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}
        className="muted"
      >
        {segments.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: s.color,
                display: 'inline-block',
              }}
            />
            {s.label} {s.value}
          </span>
        ))}
      </div>
    </div>
  );
}
