/**
 * IntegrationAdapter contract (brief §12 / Phase 12). Every connector — a CSV/XLSX
 * upload today, a REST/SFTP/SAP/Coupa pull later — implements this same shape:
 * take some source representation, map it to TRACE target fields, and produce a
 * validated **preview** with per-row errors. Nothing here does I/O or persists —
 * `@trace/db` takes the preview and writes rows.
 */

export type IntegrationKind = 'csv_activity';

export type TargetFieldKind = 'string' | 'number' | 'date' | 'enum';

export interface TargetField {
  key: string;
  label: string;
  required: boolean;
  kind: TargetFieldKind;
  /** Allowed values when `kind === 'enum'`. */
  enum?: string[];
  hint?: string;
}

/** targetField key → resolve from a source column, or a constant, or (fallback) an import default. */
export interface ColumnMapping {
  [targetKey: string]: { column?: string; constant?: string } | undefined;
}

export interface ImportDefaults {
  reportingPeriod?: string;
  subjectType?: string;
  subjectId?: string;
  provenance?: string;
}

export interface PreviewRow {
  /** 1-based data-row number (header is row 0). */
  line: number;
  raw: Record<string, string>;
  /** The typed, mapped record — null when the row has blocking errors. */
  mapped: Record<string, unknown> | null;
  errors: string[];
}

export interface ImportPreview {
  kind: IntegrationKind;
  headers: string[];
  rows: PreviewRow[];
  summary: { total: number; valid: number; invalid: number };
}

export interface PreviewInput {
  text: string;
  mapping: ColumnMapping;
  defaults: ImportDefaults;
}

export interface IntegrationAdapter {
  readonly kind: IntegrationKind;
  readonly label: string;
  /** The TRACE fields this adapter maps into, in display order. */
  targetFields(): TargetField[];
  /** An example header row for the mapping UI. */
  sampleHeaders(): string[];
  /** Parse + map + validate. Pure — no I/O, no persistence. */
  preview(input: PreviewInput): ImportPreview;
}
