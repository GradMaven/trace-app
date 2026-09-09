/**
 * Full-tenant data export (Phase 13b) — the pure parts: the catalogue of
 * sections a bundle contains and the manifest shape. The heavy lifting (reading
 * every section from Postgres, canonical-JSON serialisation, hashing, upload)
 * is in `@trace/db/governance.ts`, mirroring the Phase-8 audit package.
 */

export const EXPORT_SECTIONS = [
  'organization',
  'members',
  'roles',
  'suppliers',
  'supplier_relationships',
  'supplier_passports',
  'documents',
  'evidence',
  'datapoints',
  'activity_data',
  'emission_factors',
  'calculations',
  'emissions',
  'trust_scores',
  'data_quality_issues',
  'anomalies',
  'compliance_mappings',
  'disclosure_status',
  'audit_findings',
  'audit_simulations',
  'ask_queries',
  'procurement_scenarios',
  'integration_runs',
  'audit_log',
] as const;

export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export const EXPORT_FORMAT = 'trace.export/v1';
/** A finished export bundle is downloadable for this long, then it is purged. */
export const EXPORT_TTL_HOURS = 7 * 24;

export interface ExportManifestSection {
  section: ExportSection;
  count: number;
}

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  organizationId: string;
  generatedAt: string;
  /** Optional reporting-period filter applied to period-scoped sections. */
  reportingPeriod: string | null;
  sections: ExportManifestSection[];
  totalRecords: number;
  disclaimer: string;
}

export const EXPORT_DISCLAIMER =
  'This export is a machine-generated copy of the organization’s own records held in TRACE, ' +
  'provided for portability and archival. It is not an assurance artefact and asserts nothing ' +
  'about compliance.';

export function buildExportManifest(input: {
  organizationId: string;
  generatedAt: Date;
  reportingPeriod?: string | null;
  sections: ExportManifestSection[];
}): ExportManifest {
  const sections = [...input.sections].sort((a, b) => a.section.localeCompare(b.section));
  return {
    format: EXPORT_FORMAT,
    organizationId: input.organizationId,
    generatedAt: input.generatedAt.toISOString(),
    reportingPeriod: input.reportingPeriod ?? null,
    sections,
    totalRecords: sections.reduce((n, s) => n + s.count, 0),
    disclaimer: EXPORT_DISCLAIMER,
  };
}
