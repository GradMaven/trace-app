import {
  assembleFiling,
  canonicalJson,
  FILING_FORMAT_VERSION,
  renderFilingHtml,
  type FilingMappingInput,
  type FilingRequirement,
  type RegulatoryFiling,
} from '@trace/domain';
import { AppError } from '@trace/shared';
import { verifyAuditChain, writeAuditLog } from './audit';
import { type Prisma, type TenantDb } from './client';

/**
 * Regulatory-filing export (Phase 15). Gathers the versioned rule store, the
 * Phase-7 compliance mappings and the Phase-8 audit-chain check, hands them to
 * `assembleFiling` (pure), then content-addresses the JSON + tagged HTML to
 * object storage (`putBytes` injected, as in `generateAuditPackage`). The row
 * keeps a compact summary + storage pointers; the full document lives in storage.
 */

const DEFAULT_RULE_STORE_VERSION = 'esrs@2026.1';

export interface FilingDeps {
  driver: string;
  putBytes: (key: string, bytes: Buffer, contentType: string) => Promise<void>;
}

function activePeriod(configured: unknown, explicit: string | undefined): string {
  if (explicit) return explicit;
  if (configured && typeof configured === 'object' && 'activePeriod' in configured) {
    const v = (configured as { activePeriod?: unknown }).activePeriod;
    if (typeof v === 'string' && v) return v;
  }
  return `FY${new Date().getFullYear() - 1}`;
}

export interface RegulatoryFilingRow {
  id: string;
  version: number;
  regulationKey: string;
  ruleStoreVersion: string;
  reportingPeriod: string;
  formatVersion: string;
  readiness: string;
  requiredDatapoints: number;
  reportedDatapoints: number;
  gapCount: number;
  sha256: string;
  storageKey: string;
  htmlStorageKey: string;
  storageDriver: string;
  summary: {
    stats: RegulatoryFiling['stats'];
    gaps: RegulatoryFiling['gaps'];
    blockers: string[];
    readiness: string;
  };
  generatedByUserId: string | null;
  generatedAt: string;
}

export interface GenerateFilingResult extends RegulatoryFilingRow {
  filing: RegulatoryFiling;
}

export async function generateRegulatoryFiling(
  db: TenantDb,
  deps: FilingDeps,
  args: {
    organizationId: string;
    regulationKey?: string;
    reportingPeriod?: string;
    ruleStoreVersion?: string;
    generatedByUserId?: string | null;
    requestId: string;
  },
): Promise<GenerateFilingResult> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: args.organizationId } });
  const reportingPeriod = activePeriod(org.reportingPeriodConfig, args.reportingPeriod);
  const ruleStoreVersion = args.ruleStoreVersion ?? DEFAULT_RULE_STORE_VERSION;

  const regulation = await db.regulation.findFirst({
    where: {
      ruleStoreVersion,
      ...(args.regulationKey ? { key: args.regulationKey } : {}),
    },
    include: {
      requirements: {
        orderBy: { code: 'asc' },
        include: {
          disclosures: {
            orderBy: { code: 'asc' },
            include: { requiredDatapoints: true, evidenceRequirements: true },
          },
        },
      },
    },
  });
  if (!regulation) {
    throw AppError.notFound(
      'filing.rule_store_not_loaded',
      `Rule store "${ruleStoreVersion}" is not loaded for this organization.`,
    );
  }

  const mappings = await db.complianceMapping.findMany({
    where: { organizationId: args.organizationId, ruleStoreVersion },
  });
  const mappingByRd = new Map(mappings.map((m) => [m.requiredDatapointId, m]));

  const evidenceIds = [...new Set(mappings.flatMap((m) => m.evidenceIds))];
  const evidenceRows =
    evidenceIds.length > 0
      ? await db.evidence.findMany({
          where: { id: { in: evidenceIds }, organizationId: args.organizationId },
          select: { id: true, type: true, title: true, status: true, hash: true },
        })
      : [];
  const evidenceById = new Map(evidenceRows.map((e) => [e.id, e]));

  const statuses = await db.disclosureStatusRecord.findMany({
    where: { organizationId: args.organizationId, ruleStoreVersion },
  });
  const statusByDisclosure = new Map(statuses.map((s) => [s.disclosureId, s.status]));

  const chain = await verifyAuditChain(db, args.organizationId);

  const requirements: FilingRequirement[] = regulation.requirements.map((req) => ({
    code: req.code,
    title: req.title,
    disclosures: req.disclosures.map((dis) => ({
      code: dis.code,
      title: dis.title,
      guidance: dis.guidance,
      status: statusByDisclosure.get(dis.id) ?? 'not_started',
      requiredDatapoints: dis.requiredDatapoints.map((rd) => {
        const m = mappingByRd.get(rd.id);
        const mapping: FilingMappingInput | null = m
          ? {
              status: m.status,
              gapReasons: m.gapReasons,
              resolvedValue: m.resolvedValue != null ? Number(m.resolvedValue) : null,
              resolvedValueText: m.resolvedValueText,
              trustScore: m.trustScore,
              confirmed: m.confirmed,
              datapointIds: m.datapointIds,
              calculationIds: m.calculationIds,
              evidence: m.evidenceIds
                .map((id) => evidenceById.get(id))
                .filter((e): e is NonNullable<typeof e> => Boolean(e))
                .map((e) => ({
                  id: e.id,
                  type: e.type,
                  title: e.title,
                  status: e.status,
                  hash: e.hash,
                })),
            }
          : null;
        return {
          key: rd.key,
          label: rd.label,
          metricKey: rd.metricKey,
          unit: rd.unit,
          cardinality: rd.cardinality,
          minTrustScore: rd.minTrustScore,
          mapping,
        };
      }),
      evidenceRequirements: dis.evidenceRequirements.map((e) => ({
        key: e.key,
        description: e.description,
        acceptableTypes: e.acceptableTypes,
      })),
    })),
  }));

  const filing = assembleFiling({
    organization: {
      legalName: org.legalName,
      country: org.country,
      baseCurrency: org.baseCurrency,
    },
    regulation: {
      key: regulation.key,
      name: regulation.name,
      jurisdiction: regulation.jurisdiction,
      ruleStoreVersion,
      notice: regulation.notice,
    },
    reportingPeriod,
    requirements,
    auditChainIntact: chain.intact,
    generatedAt: new Date().toISOString(),
    generatedBy: args.generatedByUserId ?? null,
  });

  const html = renderFilingHtml(filing);
  const storageKey = `filings/${args.organizationId}/${filing.digest}/filing.json`;
  const htmlStorageKey = `filings/${args.organizationId}/${filing.digest}/filing.html`;
  await deps.putBytes(storageKey, Buffer.from(canonicalJson(filing)), 'application/json');
  await deps.putBytes(htmlStorageKey, Buffer.from(html), 'text/html; charset=utf-8');

  const prev = await db.regulatoryFiling.findFirst({
    where: {
      organizationId: args.organizationId,
      regulationKey: regulation.key,
      reportingPeriod,
    },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });
  const version = (prev?.version ?? 0) + 1;

  const summary = {
    stats: filing.stats,
    gaps: filing.gaps,
    blockers: filing.blockers,
    readiness: filing.readiness,
  };

  const row = await db.regulatoryFiling.create({
    data: {
      organizationId: args.organizationId,
      regulationKey: regulation.key,
      ruleStoreVersion,
      reportingPeriod,
      formatVersion: FILING_FORMAT_VERSION,
      version,
      readiness: filing.readiness,
      requiredDatapoints: filing.stats.requiredDatapoints,
      reportedDatapoints: filing.stats.reported,
      gapCount: filing.gaps.length,
      sha256: filing.digest,
      storageKey,
      htmlStorageKey,
      storageDriver: deps.driver,
      summary: summary as unknown as Prisma.InputJsonValue,
      supersedesId: prev?.id ?? null,
      generatedByUserId: args.generatedByUserId ?? null,
    },
  });

  await writeAuditLog(db, {
    organizationId: args.organizationId,
    actorId: args.generatedByUserId ?? null,
    action: 'filing.generated',
    resourceType: 'regulatory_filing',
    resourceId: row.id,
    before: null,
    after: {
      regulationKey: regulation.key,
      reportingPeriod,
      version,
      readiness: filing.readiness,
      gaps: filing.gaps.length,
    },
    requestId: args.requestId,
  });

  return { ...toRow(row), filing };
}

function toRow(row: {
  id: string;
  version: number;
  regulationKey: string;
  ruleStoreVersion: string;
  reportingPeriod: string;
  formatVersion: string;
  readiness: string;
  requiredDatapoints: number;
  reportedDatapoints: number;
  gapCount: number;
  sha256: string;
  storageKey: string;
  htmlStorageKey: string;
  storageDriver: string;
  summary: unknown;
  generatedByUserId: string | null;
  generatedAt: Date;
}): RegulatoryFilingRow {
  return {
    id: row.id,
    version: row.version,
    regulationKey: row.regulationKey,
    ruleStoreVersion: row.ruleStoreVersion,
    reportingPeriod: row.reportingPeriod,
    formatVersion: row.formatVersion,
    readiness: row.readiness,
    requiredDatapoints: row.requiredDatapoints,
    reportedDatapoints: row.reportedDatapoints,
    gapCount: row.gapCount,
    sha256: row.sha256,
    storageKey: row.storageKey,
    htmlStorageKey: row.htmlStorageKey,
    storageDriver: row.storageDriver,
    summary: row.summary as RegulatoryFilingRow['summary'],
    generatedByUserId: row.generatedByUserId,
    generatedAt: row.generatedAt.toISOString(),
  };
}

export async function listRegulatoryFilings(
  db: TenantDb,
  organizationId: string,
): Promise<RegulatoryFilingRow[]> {
  const rows = await db.regulatoryFiling.findMany({
    where: { organizationId },
    orderBy: { generatedAt: 'desc' },
    take: 50,
  });
  return rows.map(toRow);
}

export async function regulatoryFilingById(
  db: TenantDb,
  organizationId: string,
  id: string,
): Promise<RegulatoryFilingRow> {
  const row = await db.regulatoryFiling.findFirst({ where: { id, organizationId } });
  if (!row) throw AppError.notFound('filing.not_found', 'Regulatory filing not found.');
  return toRow(row);
}

export async function latestRegulatoryFiling(
  db: TenantDb,
  organizationId: string,
  regulationKey: string,
  reportingPeriod: string,
): Promise<RegulatoryFilingRow | null> {
  const row = await db.regulatoryFiling.findFirst({
    where: { organizationId, regulationKey, reportingPeriod },
    orderBy: { version: 'desc' },
  });
  return row ? toRow(row) : null;
}
