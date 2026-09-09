import { describe, expect, it } from 'vitest';
import { buildHealthReport, heartbeatStatus, rollUpHealth } from './health';

describe('rollUpHealth', () => {
  it('is unhealthy if anything is down', () => {
    expect(
      rollUpHealth([
        { name: 'db', status: 'up' },
        { name: 'worker', status: 'down' },
      ]),
    ).toBe('unhealthy');
  });
  it('is degraded if anything is degraded but nothing down', () => {
    expect(
      rollUpHealth([
        { name: 'db', status: 'up' },
        { name: 'worker', status: 'degraded' },
      ]),
    ).toBe('degraded');
  });
  it('is healthy when all up', () => {
    expect(rollUpHealth([{ name: 'db', status: 'up' }])).toBe('healthy');
  });
});

describe('buildHealthReport', () => {
  it('rounds uptime and stamps the roll-up', () => {
    const r = buildHealthReport({
      version: '1.2.3',
      uptimeSeconds: 42.7,
      checks: [{ name: 'db', status: 'up', latencyMs: 3 }],
      now: new Date('2026-06-01T00:00:00Z'),
    });
    expect(r).toMatchObject({ status: 'healthy', version: '1.2.3', uptimeSeconds: 43 });
    expect(r.generatedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('heartbeatStatus', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  it('is up when fresh, degraded when stale, down when very stale or missing', () => {
    expect(heartbeatStatus(new Date(now.getTime() - 30_000), now).status).toBe('up');
    expect(heartbeatStatus(new Date(now.getTime() - 200_000), now).status).toBe('degraded');
    expect(heartbeatStatus(new Date(now.getTime() - 900_000), now).status).toBe('down');
    expect(heartbeatStatus(null, now)).toEqual({ status: 'down', ageSeconds: null });
  });
});
