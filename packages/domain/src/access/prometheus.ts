/**
 * Prometheus text exposition format (Phase 13d) — pure serialiser for the
 * `/metrics` endpoint. Follows the 0.0.4 line format: `# HELP`, `# TYPE`, then
 * `name{label="value",...} number`.
 */

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export interface MetricSample {
  name: string;
  help: string;
  type: 'counter' | 'gauge';
  value: number;
  labels?: Record<string, string>;
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labels?: Record<string, string>): string {
  const entries = Object.entries(labels ?? {}).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return `{${entries.map(([k, v]) => `${k}="${escapeLabelValue(String(v))}"`).join(',')}}`;
}

/** Render samples grouped by metric name with one HELP/TYPE header per group. */
export function renderPrometheus(samples: MetricSample[]): string {
  const byName = new Map<string, MetricSample[]>();
  for (const s of samples) {
    let arr = byName.get(s.name);
    if (!arr) {
      arr = [];
      byName.set(s.name, arr);
    }
    arr.push(s);
  }
  const lines: string[] = [];
  for (const [name, group] of byName) {
    const first = group[0]!;
    lines.push(`# HELP ${name} ${first.help}`);
    lines.push(`# TYPE ${name} ${first.type}`);
    for (const s of group) {
      const v = Number.isFinite(s.value) ? s.value : 0;
      lines.push(`${name}${renderLabels(s.labels)} ${v}`);
    }
  }
  return lines.join('\n') + '\n';
}
