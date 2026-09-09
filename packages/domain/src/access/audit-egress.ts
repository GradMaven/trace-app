/**
 * Audit-log egress (Phase 13c) — pure helpers for the filtered query + NDJSON
 * bulk export. The rows themselves are read in `@trace/db`; this owns the filter
 * shape, its normalisation, and the newline-delimited-JSON serialiser.
 */

export const AUDIT_EXPORT_MAX_ROWS = 20_000;

export interface AuditQueryFilter {
  /** Match actions that start with this (e.g. `evidence.` or `evidence.transitioned.`). */
  actionPrefix?: string;
  actorId?: string;
  resourceType?: string;
  /** ISO instants. */
  from?: string;
  to?: string;
}

export interface NormalizedAuditFilter {
  actionPrefix?: string;
  actorId?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
}

export function normalizeAuditFilter(input: AuditQueryFilter): NormalizedAuditFilter {
  const out: NormalizedAuditFilter = {};
  if (input.actionPrefix && /^[a-z][a-z0-9_.]{0,60}$/.test(input.actionPrefix)) {
    out.actionPrefix = input.actionPrefix;
  }
  if (input.actorId) out.actorId = input.actorId;
  if (input.resourceType && /^[a-z][a-z0-9_]{0,60}$/.test(input.resourceType)) {
    out.resourceType = input.resourceType;
  }
  if (input.from) {
    const d = new Date(input.from);
    if (!Number.isNaN(d.getTime())) out.from = d;
  }
  if (input.to) {
    const d = new Date(input.to);
    if (!Number.isNaN(d.getTime())) out.to = d;
  }
  return out;
}

export interface AuditExportRow {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  requestId: string;
  createdAt: string;
  prevHash: string;
  hash: string;
}

/** One compact JSON object per line, trailing newline. */
export function toNdjson(rows: AuditExportRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}
