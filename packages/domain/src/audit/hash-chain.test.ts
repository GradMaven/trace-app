import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  appendEntry,
  canonicalJson,
  verifyChain,
  type AuditEntryInput,
  type HashedAuditEntry,
} from './hash-chain';

function entry(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    organizationId: 'org_1',
    actorId: 'user_1',
    action: 'organization.created',
    resourceType: 'organization',
    resourceId: 'org_1',
    before: null,
    after: { name: 'NordWerk' },
    requestId: 'req_1',
    createdAt: '2026-09-08T10:00:00.000Z',
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('is stable regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('drops undefined but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe('audit hash chain', () => {
  it('links entries and verifies an intact chain', () => {
    const e1 = appendEntry(GENESIS_HASH, entry({ requestId: 'req_1' }));
    const e2 = appendEntry(e1.hash, entry({ action: 'member.invited', requestId: 'req_2' }));
    const e3 = appendEntry(e2.hash, entry({ action: 'role.assigned', requestId: 'req_3' }));

    expect(e2.prevHash).toBe(e1.hash);
    expect(verifyChain([e1, e2, e3])).toEqual({ intact: true, brokenAt: -1 });
  });

  it('detects a tampered payload', () => {
    const e1 = appendEntry(GENESIS_HASH, entry());
    const e2 = appendEntry(e1.hash, entry({ action: 'member.invited' }));
    const tampered: HashedAuditEntry = { ...e2, after: { name: 'Altered' } };
    expect(verifyChain([e1, tampered])).toEqual({ intact: false, brokenAt: 1 });
  });

  it('detects a broken link', () => {
    const e1 = appendEntry(GENESIS_HASH, entry());
    const e2 = appendEntry(e1.hash, entry({ action: 'x' }));
    const e3 = appendEntry('deadbeef'.repeat(8), entry({ action: 'y' }));
    expect(verifyChain([e1, e2, e3])).toEqual({ intact: false, brokenAt: 2 });
  });

  it('is deterministic', () => {
    const a = appendEntry(GENESIS_HASH, entry());
    const b = appendEntry(GENESIS_HASH, entry());
    expect(a.hash).toBe(b.hash);
  });
});
