import type { EvidenceStatus, Permission } from '@trace/shared';

/**
 * Evidence lifecycle state machine (docs/domain-model.md, brief §6).
 *
 *   uploaded → processing → extracted → reviewed → verified → (expired | superseded)
 *                                          └────────────────→ rejected
 *
 * `processing`/`extracted` are set by the AI pipeline (Phase 5); in Phase 3
 * evidence created with a document lands in `uploaded` and a human moves it
 * through `reviewed` → `verified`/`rejected`. Any state can be `superseded` when
 * a newer version replaces it, and `verified` evidence can later `expire`.
 *
 * Pure — no I/O. The caller persists the new state and writes the audit entry.
 */

const TRANSITIONS: Record<EvidenceStatus, EvidenceStatus[]> = {
  uploaded: ['processing', 'reviewed', 'rejected', 'superseded'],
  processing: ['extracted', 'reviewed', 'rejected', 'superseded'],
  extracted: ['reviewed', 'rejected', 'superseded'],
  reviewed: ['verified', 'rejected', 'superseded'],
  verified: ['expired', 'superseded'],
  rejected: ['superseded'],
  expired: ['superseded'],
  superseded: [],
};

/** Transitions that require the elevated `evidence.verify` permission. */
const VERIFY_TRANSITIONS = new Set<EvidenceStatus>(['verified', 'rejected', 'expired']);

export function nextStates(from: EvidenceStatus): EvidenceStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

export function canTransition(from: EvidenceStatus, to: EvidenceStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function requiredPermissionForTransition(to: EvidenceStatus): Permission {
  return VERIFY_TRANSITIONS.has(to) ? 'evidence.verify' : 'evidence.update';
}

export function isTerminal(status: EvidenceStatus): boolean {
  return TRANSITIONS[status]?.length === 0;
}

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
  requiredPermission?: Permission;
}

export function checkTransition(
  from: EvidenceStatus,
  to: EvidenceStatus,
  heldPermissions: readonly Permission[],
): TransitionCheck {
  if (from === to) return { ok: false, reason: 'Evidence is already in that state.' };
  if (!canTransition(from, to)) {
    return { ok: false, reason: `Cannot move evidence from "${from}" to "${to}".` };
  }
  const requiredPermission = requiredPermissionForTransition(to);
  if (!heldPermissions.includes(requiredPermission)) {
    return { ok: false, reason: `Missing permission: ${requiredPermission}.`, requiredPermission };
  }
  return { ok: true, requiredPermission };
}
