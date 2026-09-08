import { buildPassport, type PassportInput } from '@trace/domain';
import { writeAuditLog } from './audit';
import { type TenantDb } from './client';

/**
 * Supplier Passport recomputation — shared by the API's explicit recompute
 * endpoint and the automatic recompute after a questionnaire is submitted, so
 * the two never diverge.
 *
 * Passports are append-only versioned snapshots (ADR-004): each call inserts a
 * new `supplier_passport` row with `version = max(version) + 1` and writes an
 * audit entry. `db` must already be a tenant transaction for `organizationId`.
 */
export interface RecomputePassportArgs {
  organizationId: string;
  supplierId: string;
  computedByUserId: string | null;
  requestId: string;
}

export interface RecomputedPassport {
  id: string;
  version: number;
  completeness: number;
  data: unknown;
  computedAt: string;
}

export async function recomputeSupplierPassport(
  db: TenantDb,
  args: RecomputePassportArgs,
): Promise<RecomputedPassport> {
  const supplier = await db.supplier.findFirst({
    where: { id: args.supplierId, organizationId: args.organizationId },
    include: { relationship: true },
  });
  if (!supplier) {
    throw new Error(`Supplier ${args.supplierId} not found in organization ${args.organizationId}`);
  }

  const latestSubmitted = await db.supplierRequest.findFirst({
    where: {
      supplierId: args.supplierId,
      kind: 'sustainability_questionnaire',
      status: { in: ['submitted', 'accepted'] },
      submittedAt: { not: null },
    },
    orderBy: { submittedAt: 'desc' },
  });

  const evidence = await db.supplierEvidenceRef.findMany({
    where: { supplierId: args.supplierId },
    select: { verified: true, reportingPeriod: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const input: PassportInput = {
    supplier: {
      name: supplier.name,
      country: supplier.country,
      industryNace: supplier.industryNace,
      status: supplier.status,
    },
    relationship: supplier.relationship
      ? {
          category: supplier.relationship.category,
          tier: supplier.relationship.tier,
          annualSpend: supplier.relationship.annualSpend?.toString() ?? null,
          currency: supplier.relationship.currency,
        }
      : null,
    questionnaire: latestSubmitted
      ? {
          version: latestSubmitted.templateVersion,
          submittedAt: (latestSubmitted.submittedAt ?? latestSubmitted.createdAt).toISOString(),
          responses: (latestSubmitted.responses ?? {}) as Record<string, unknown>,
        }
      : null,
    evidence: {
      count: evidence.length,
      verifiedCount: evidence.filter((e) => e.verified).length,
      latestReportingPeriod: evidence.find((e) => e.reportingPeriod)?.reportingPeriod ?? null,
    },
  };

  const data = buildPassport(input);

  const last = await db.supplierPassport.findFirst({
    where: { supplierId: args.supplierId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const row = await db.supplierPassport.create({
    data: {
      organizationId: args.organizationId,
      supplierId: args.supplierId,
      version,
      builderVersion: data.builderVersion,
      completeness: data.completeness,
      data: data as unknown as object,
      computedByUserId: args.computedByUserId,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.computedByUserId,
    action: 'supplier.passport_recomputed',
    resourceType: 'supplier_passport',
    resourceId: row.id,
    before: last ? { version: last.version } : null,
    after: { version, completeness: data.completeness },
    requestId: args.requestId,
  });

  return {
    id: row.id,
    version,
    completeness: data.completeness,
    data,
    computedAt: row.computedAt.toISOString(),
  };
}
