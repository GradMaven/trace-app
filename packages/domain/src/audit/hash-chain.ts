import { createHash } from 'node:crypto';

/**
 * Tamper-evident audit log (docs/security.md, ADR-004).
 *
 * Each entry stores `hash = sha256(prevHash || canonicalJson(payload))`. The
 * first entry uses `GENESIS_HASH` as `prevHash`. `verifyChain` recomputes the
 * whole chain and returns the index of the first break, or -1 if intact.
 *
 * Pure functions only — the API persists the result; this package computes it.
 */

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntryInput {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  requestId: string;
  createdAt: string; // ISO 8601
}

export interface HashedAuditEntry extends AuditEntryInput {
  prevHash: string;
  hash: string;
}

/**
 * Deterministic JSON: object keys sorted recursively, no insignificant
 * whitespace. Arrays keep their order. `undefined` fields are dropped.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function computeEntryHash(prevHash: string, entry: AuditEntryInput): string {
  return createHash('sha256').update(prevHash).update(canonicalJson(entry)).digest('hex');
}

export function appendEntry(prevHash: string, entry: AuditEntryInput): HashedAuditEntry {
  return { ...entry, prevHash, hash: computeEntryHash(prevHash, entry) };
}

export interface ChainVerificationResult {
  intact: boolean;
  /** Index of the first invalid entry, or -1 when the chain is intact. */
  brokenAt: number;
}

export function verifyChain(
  entries: readonly HashedAuditEntry[],
  genesis = GENESIS_HASH,
): ChainVerificationResult {
  let prev = genesis;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.prevHash !== prev) return { intact: false, brokenAt: i };
    const { prevHash: _p, hash: _h, ...input } = entry;
    if (computeEntryHash(prev, input) !== entry.hash) return { intact: false, brokenAt: i };
    prev = entry.hash;
  }
  return { intact: true, brokenAt: -1 };
}
