import { GHG_CATEGORY, GHG_SCOPE, PROVENANCE } from '@trace/shared';
import { isKnownUnit } from '../carbon/units';
import { parseDelimited } from './csv';
import type {
  ColumnMapping,
  ImportDefaults,
  ImportPreview,
  IntegrationAdapter,
  PreviewInput,
  PreviewRow,
  TargetField,
} from './adapter';

/**
 * CSV / TSV → `activity_data`. The workhorse import for Phase 12: an analyst
 * exports facility energy, fuel, freight or purchased-goods rows from a
 * spreadsheet or ERP and maps the columns onto the TRACE activity-data shape.
 */

const SUBJECT_TYPES = ['organization', 'business_unit', 'supplier', 'facility', 'product'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const FIELDS: TargetField[] = [
  { key: 'scope', label: 'GHG scope', required: true, kind: 'enum', enum: [...GHG_SCOPE] },
  {
    key: 'category',
    label: 'Activity category',
    required: true,
    kind: 'string',
    hint: 'e.g. "Purchased electricity"',
  },
  { key: 'value', label: 'Quantity', required: true, kind: 'number' },
  { key: 'unit', label: 'Unit', required: true, kind: 'string', hint: 'kWh, L, t, t.km, EUR …' },
  {
    key: 'reportingPeriod',
    label: 'Reporting period',
    required: true,
    kind: 'string',
    hint: 'e.g. FY2025',
  },
  {
    key: 'subjectType',
    label: 'Subject type',
    required: true,
    kind: 'enum',
    enum: [...SUBJECT_TYPES],
  },
  { key: 'subjectId', label: 'Subject id (UUID)', required: true, kind: 'string' },
  {
    key: 'ghgCategory',
    label: 'Scope 3 category',
    required: false,
    kind: 'enum',
    enum: [...GHG_CATEGORY],
  },
  { key: 'provenance', label: 'Provenance', required: false, kind: 'enum', enum: [...PROVENANCE] },
  { key: 'description', label: 'Description', required: false, kind: 'string' },
  { key: 'supplierId', label: 'Supplier id (UUID)', required: false, kind: 'string' },
  { key: 'occurredOn', label: 'Occurred on (YYYY-MM-DD)', required: false, kind: 'date' },
];

function resolve(
  targetKey: string,
  mapping: ColumnMapping,
  defaults: ImportDefaults,
  raw: Record<string, string>,
): string {
  const m = mapping[targetKey];
  if (m?.constant != null && m.constant !== '') return m.constant.trim();
  if (m?.column && raw[m.column] != null) return raw[m.column]!.trim();
  const d = (defaults as Record<string, string | undefined>)[targetKey];
  return (d ?? '').trim();
}

function validateRow(mapped: Record<string, string>): {
  errors: string[];
  typed: Record<string, unknown> | null;
} {
  const errors: string[] = [];
  const typed: Record<string, unknown> = {};

  for (const f of FIELDS) {
    const v = mapped[f.key] ?? '';
    if (!v) {
      if (f.required) errors.push(`${f.label} is missing`);
      continue;
    }
    if (f.kind === 'number') {
      const n = Number(v.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0)
        errors.push(`${f.label} "${v}" is not a non-negative number`);
      else typed[f.key] = n;
      continue;
    }
    if (f.kind === 'enum' && f.enum && !f.enum.includes(v)) {
      errors.push(`${f.label} "${v}" is not one of: ${f.enum.join(', ')}`);
      continue;
    }
    if (f.kind === 'date' && (!DATE_RE.test(v) || Number.isNaN(Date.parse(v)))) {
      errors.push(`${f.label} "${v}" is not a valid YYYY-MM-DD date`);
      continue;
    }
    typed[f.key] = v;
  }

  if (typed.unit && !isKnownUnit(String(typed.unit))) {
    errors.push(`Unit "${String(typed.unit)}" is not in the TRACE unit registry`);
  }
  if (typed.subjectId && !UUID_RE.test(String(typed.subjectId))) {
    errors.push(`Subject id "${String(typed.subjectId)}" is not a UUID`);
  }
  if (typed.supplierId && !UUID_RE.test(String(typed.supplierId))) {
    errors.push(`Supplier id "${String(typed.supplierId)}" is not a UUID`);
  }

  return { errors, typed: errors.length === 0 ? typed : null };
}

export class CsvActivityAdapter implements IntegrationAdapter {
  readonly kind = 'csv_activity' as const;
  readonly label = 'CSV / TSV — activity data';

  targetFields(): TargetField[] {
    return FIELDS.map((f) => ({ ...f }));
  }

  sampleHeaders(): string[] {
    return [
      'scope',
      'category',
      'value',
      'unit',
      'period',
      'subject_type',
      'subject_id',
      'provenance',
    ];
  }

  preview(input: PreviewInput): ImportPreview {
    const { headers, rows } = parseDelimited(input.text);
    const previewRows: PreviewRow[] = rows.map((cells, idx) => {
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => (raw[h] = cells[i] ?? ''));

      const mapped: Record<string, string> = {};
      for (const f of FIELDS) mapped[f.key] = resolve(f.key, input.mapping, input.defaults, raw);
      const { errors, typed } = validateRow(mapped);

      return { line: idx + 1, raw, mapped: typed, errors };
    });

    const valid = previewRows.filter((r) => r.errors.length === 0).length;
    return {
      kind: this.kind,
      headers,
      rows: previewRows,
      summary: { total: previewRows.length, valid, invalid: previewRows.length - valid },
    };
  }
}
