import { describe, expect, it } from 'vitest';
import { normalizeAuditFilter, toNdjson, type AuditExportRow } from './audit-egress';

describe('normalizeAuditFilter', () => {
  it('keeps well-formed filters and drops malformed ones', () => {
    const n = normalizeAuditFilter({
      actionPrefix: 'evidence.transitioned.',
      resourceType: 'evidence',
      actorId: 'u_1',
      from: '2026-01-01T00:00:00Z',
      to: 'not-a-date',
    });
    expect(n.actionPrefix).toBe('evidence.transitioned.');
    expect(n.resourceType).toBe('evidence');
    expect(n.actorId).toBe('u_1');
    expect(n.from).toBeInstanceOf(Date);
    expect(n.to).toBeUndefined();
  });

  it('rejects an injection-shaped prefix', () => {
    expect(normalizeAuditFilter({ actionPrefix: "evidence'; DROP" }).actionPrefix).toBeUndefined();
    expect(normalizeAuditFilter({ resourceType: 'Evidence OR 1=1' }).resourceType).toBeUndefined();
  });
});

describe('toNdjson', () => {
  const row = (id: string): AuditExportRow => ({
    id,
    organizationId: 'org_1',
    actorId: 'u_1',
    action: 'evidence.created',
    resourceType: 'evidence',
    resourceId: 'e_1',
    before: null,
    after: { title: 't' },
    requestId: 'r',
    createdAt: '2026-01-01T00:00:00.000Z',
    prevHash: 'p',
    hash: 'h',
  });

  it('emits one JSON object per line with a trailing newline', () => {
    const s = toNdjson([row('a'), row('b')]);
    const lines = s.split('\n');
    expect(lines).toHaveLength(3); // a, b, ''
    expect(JSON.parse(lines[0]!).id).toBe('a');
    expect(s.endsWith('\n')).toBe(true);
  });

  it('is empty for no rows', () => {
    expect(toNdjson([])).toBe('');
  });
});
