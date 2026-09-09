import { describe, expect, it } from 'vitest';
import { renderPrometheus, type MetricSample } from './prometheus';

describe('renderPrometheus', () => {
  it('emits one HELP/TYPE header per metric name and a line per sample', () => {
    const samples: MetricSample[] = [
      { name: 'trace_orgs_total', help: 'Organizations', type: 'gauge', value: 3 },
      {
        name: 'trace_deliveries',
        help: 'Webhook deliveries',
        type: 'counter',
        value: 10,
        labels: { status: 'pending' },
      },
      {
        name: 'trace_deliveries',
        help: 'Webhook deliveries',
        type: 'counter',
        value: 2,
        labels: { status: 'failed' },
      },
    ];
    const text = renderPrometheus(samples);
    const lines = text.trim().split('\n');
    expect(lines).toEqual([
      '# HELP trace_orgs_total Organizations',
      '# TYPE trace_orgs_total gauge',
      'trace_orgs_total 3',
      '# HELP trace_deliveries Webhook deliveries',
      '# TYPE trace_deliveries counter',
      'trace_deliveries{status="pending"} 10',
      'trace_deliveries{status="failed"} 2',
    ]);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('escapes label values and coerces non-finite numbers to 0', () => {
    const text = renderPrometheus([
      { name: 'm', help: 'h', type: 'gauge', value: NaN, labels: { path: 'a"b\\c' } },
    ]);
    expect(text).toContain('m{path="a\\"b\\\\c"} 0');
  });
});
