import { checkTransition } from '@trace/domain';
import { AppError, type EvidenceStatus, type Permission } from '@trace/shared';
import { writeAuditLog } from './audit';
import { type TenantDb } from './client';

/**
 * Evidence lifecycle operations shared by the API and (Phase 5) the AI worker.
 * State transitions are validated by the pure state machine in @trace/domain;
 * this module persists the result and writes the audit + verification records.
 * `db` must already be a tenant transaction for `organizationId`.
 */

export interface TransitionEvidenceArgs {
  organizationId: string;
  evidenceId: string;
  to: EvidenceStatus;
  actorUserId: string;
  permissions: readonly Permission[];
  method?: string;
  note?: string;
  requestId: string;
}

export async function transitionEvidence(
  db: TenantDb,
  args: TransitionEvidenceArgs,
): Promise<{ id: string; status: EvidenceStatus }> {
  const evidence = await db.evidence.findFirst({
    where: { id: args.evidenceId, organizationId: args.organizationId },
  });
  if (!evidence) throw AppError.notFound('evidence.not_found', 'Evidence not found.');

  const check = checkTransition(evidence.status, args.to, args.permissions);
  if (!check.ok) {
    throw check.requiredPermission
      ? AppError.forbidden('evidence.transition_forbidden', check.reason ?? 'Not allowed.')
      : AppError.conflict('evidence.invalid_transition', check.reason ?? 'Invalid transition.');
  }

  await db.evidence.update({
    where: { id: evidence.id },
    data: {
      status: args.to,
      ...(args.to === 'expired' && !evidence.expiresAt ? { expiresAt: new Date() } : {}),
    },
  });

  if (args.to === 'verified' || args.to === 'rejected') {
    await db.evidenceVerification.create({
      data: {
        organizationId: args.organizationId,
        evidenceId: evidence.id,
        method: args.method ?? 'manual_review',
        outcome: args.to,
        verifiedByUserId: args.actorUserId,
        notes: args.note ?? null,
      },
    });
  }

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: `evidence.transitioned.${args.to}`,
    resourceType: 'evidence',
    resourceId: evidence.id,
    before: { status: evidence.status },
    after: { status: args.to, note: args.note ?? null },
    requestId: args.requestId,
  });

  return { id: evidence.id, status: args.to };
}

export interface SupersedeEvidenceArgs {
  organizationId: string;
  evidenceId: string;
  actorUserId: string;
  requestId: string;
  overrides: {
    title?: string;
    documentId?: string | null;
    sourceUrl?: string | null;
    reportingPeriod?: string | null;
    issuer?: string | null;
  };
}

export async function supersedeEvidence(
  db: TenantDb,
  args: SupersedeEvidenceArgs,
): Promise<{ id: string; version: number }> {
  const old = await db.evidence.findFirst({
    where: { id: args.evidenceId, organizationId: args.organizationId },
  });
  if (!old) throw AppError.notFound('evidence.not_found', 'Evidence not found.');
  if (old.status === 'superseded') {
    throw AppError.conflict('evidence.already_superseded', 'This evidence is already superseded.');
  }

  const created = await db.evidence.create({
    data: {
      organizationId: args.organizationId,
      type: old.type,
      title: args.overrides.title ?? old.title,
      documentId:
        args.overrides.documentId !== undefined ? args.overrides.documentId : old.documentId,
      source: old.source,
      sourceUrl:
        args.overrides.sourceUrl !== undefined ? args.overrides.sourceUrl : old.sourceUrl,
      reportingPeriod:
        args.overrides.reportingPeriod !== undefined
          ? args.overrides.reportingPeriod
          : old.reportingPeriod,
      issuer: args.overrides.issuer !== undefined ? args.overrides.issuer : old.issuer,
      hash: old.hash,
      metadata: old.metadata as object,
      status: 'uploaded',
      version: old.version + 1,
      supersedesId: old.id,
      uploadedByUserId: args.actorUserId,
    },
  });

  await db.evidence.update({ where: { id: old.id }, data: { status: 'superseded' } });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.actorUserId,
    action: 'evidence.superseded',
    resourceType: 'evidence',
    resourceId: old.id,
    before: { version: old.version, status: old.status },
    after: { supersededBy: created.id, newVersion: created.version },
    requestId: args.requestId,
  });

  return { id: created.id, version: created.version };
}
