import { describe, expect, it } from 'vitest';
import {
  AUDIT_STREAM_MAX_ATTEMPTS,
  auditStreamNextAttemptAt,
  buildAuditStreamBatch,
  matchesAuditStream,
  normalizeAuditStreamFilter,
  type AuditStreamEntry,
} from './audit-stream';

describe('normalizeAuditStreamFilter', () => {
  it('keeps well-formed prefixes / resource types and drops the rest', () => {
    const f = normalizeAuditStreamFilter({
      actionPrefixes: ['evidence.', 'compliance.', "bad'; DROP", 'evidence.'],
      resourceTypes: ['evidence', 'Bad Type', 'calculation'],
    });
    expect(f.actionPrefixes).toEqual(['evidence.', 'compliance.']);
    expect(f.resourceTypes).toEqual(['evidence', 'calculation']);
  });

  it('drops empty arrays entirely', () => {
    expect(normalizeAuditStreamFilter({ actionPrefixes: [], resourceTypes: [] })).toEqual({});
  });
});

describe('matchesAuditStream', () => {
  it('matches everything when the filter is empty', () => {
    expect(matchesAuditStream({}, { action: 'anything.here', resourceType: 'x' })).toBe(true);
  });

  it('matches on an action prefix', () => {
    const f = { actionPrefixes: ['evidence.transitioned.'] };
    expect(
      matchesAuditStream(f, { action: 'evidence.transitioned.verified', resourceType: 'evidence' }),
    ).toBe(true);
    expect(matchesAuditStream(f, { action: 'evidence.created', resourceType: 'evidence' })).toBe(
      false,
    );
  });

  it('ANDs the resource-type restriction', () => {
    const f = { actionPrefixes: ['compliance.'], resourceTypes: ['compliance_run'] };
    expect(
      matchesAuditStream(f, { action: 'compliance.evaluated', resourceType: 'compliance_run' }),
    ).toBe(true);
    expect(
      matchesAuditStream(f, { action: 'compliance.evaluated', resourceType: 'compliance_mapping' }),
    ).toBe(false);
  });
});

describe('auditStreamNextAttemptAt', () => {
  it('backs off and clamps out-of-range attempt numbers', () => {
    const from = new Date('2026-06-01T00:00:00Z');
    expect(auditStreamNextAttemptAt(1, from).getTime()).toBe(from.getTime());
    expect(auditStreamNextAttemptAt(2, from).getTime()).toBeGreaterThan(from.getTime());
    expect(auditStreamNextAttemptAt(99, from).getTime()).toBe(
      auditStreamNextAttemptAt(AUDIT_STREAM_MAX_ATTEMPTS, from).getTime(),
    );
  });
});

describe('buildAuditStreamBatch', () => {
  it('wraps entries in a stable envelope', () => {
    const entries: AuditStreamEntry[] = [
      {
        id: 'a1',
        organizationId: 'org_1',
        actorId: 'u_1',
        action: 'evidence.created',
        resourceType: 'evidence',
        resourceId: 'e_1',
        requestId: 'r',
        createdAt: '2026-06-01T00:00:00.000Z',
        prevHash: 'p',
        hash: 'h',
      },
    ];
    const batch = buildAuditStreamBatch({
      streamId: 's_1',
      organizationId: 'org_1',
      deliveryId: 'd_1',
      sentAt: new Date('2026-06-01T00:00:01Z'),
      entries,
    });
    expect(batch).toMatchObject({ stream: 'audit-log', streamId: 's_1', count: 1 });
    expect(batch.entries[0]!.id).toBe('a1');
  });
});
