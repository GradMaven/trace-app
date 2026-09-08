/**
 * The Phase 2 supplier sustainability questionnaire.
 *
 * A fixed, versioned template. Later phases replace this with a
 * compliance-driven, per-requirement question set sourced from the versioned
 * rule store (docs/compliance-architecture.md); the shape here is deliberately
 * close to what that will produce so the portal UI and passport builder do not
 * need reworking.
 *
 * Pure data + validation only — no I/O.
 */

export const QUESTIONNAIRE_VERSION = 'supplier-sustainability@1';

export type QuestionKind = 'text' | 'number' | 'boolean' | 'single_select' | 'multi_select';

export interface QuestionOption {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  label: string;
  help?: string;
  kind: QuestionKind;
  unit?: string;
  required: boolean;
  options?: QuestionOption[];
}

export interface QuestionnaireSection {
  id: 'identity' | 'carbon' | 'environmental' | 'social' | 'governance';
  title: string;
  questions: Question[];
}

export const SUPPLIER_QUESTIONNAIRE: QuestionnaireSection[] = [
  {
    id: 'identity',
    title: 'Identity & reporting',
    questions: [
      {
        id: 'reporting_period',
        label: 'Most recent reporting period (financial year)',
        kind: 'text',
        required: true,
        help: 'e.g. FY2025 or 2025-01-01 – 2025-12-31',
      },
      {
        id: 'employees_fte',
        label: 'Employees (full-time equivalent)',
        kind: 'number',
        unit: 'FTE',
        required: false,
      },
      {
        id: 'primary_activity',
        label: 'Primary activity at the sites supplying this customer',
        kind: 'text',
        required: true,
      },
    ],
  },
  {
    id: 'carbon',
    title: 'Carbon & energy',
    questions: [
      {
        id: 'ghg_inventory_exists',
        label: 'Do you maintain a GHG inventory?',
        kind: 'boolean',
        required: true,
      },
      {
        id: 'scope1_tco2e',
        label: 'Scope 1 emissions (most recent reporting period)',
        kind: 'number',
        unit: 'tCO2e',
        required: false,
      },
      {
        id: 'scope2_method',
        label: 'Scope 2 accounting method',
        kind: 'single_select',
        required: false,
        options: [
          { value: 'location_based', label: 'Location-based' },
          { value: 'market_based', label: 'Market-based' },
          { value: 'both', label: 'Both' },
          { value: 'not_calculated', label: 'Not calculated' },
        ],
      },
      {
        id: 'scope2_tco2e',
        label: 'Scope 2 emissions (most recent reporting period)',
        kind: 'number',
        unit: 'tCO2e',
        required: false,
      },
      {
        id: 'scope3_categories_reported',
        label: 'Scope 3 categories you report',
        kind: 'multi_select',
        required: false,
        options: [
          { value: 'cat1', label: '1 — Purchased goods & services' },
          { value: 'cat4', label: '4 — Upstream transportation' },
          { value: 'cat6', label: '6 — Business travel' },
          { value: 'cat7', label: '7 — Employee commuting' },
          { value: 'cat9', label: '9 — Downstream transportation' },
        ],
      },
      {
        id: 'renewable_electricity_pct',
        label: 'Share of electricity from renewable sources',
        kind: 'number',
        unit: '%',
        required: false,
      },
      {
        id: 'reduction_target',
        label: 'Do you have a published emissions reduction target?',
        kind: 'boolean',
        required: true,
      },
    ],
  },
  {
    id: 'environmental',
    title: 'Environmental management',
    questions: [
      {
        id: 'iso14001',
        label: 'ISO 14001 certified?',
        kind: 'boolean',
        required: true,
      },
      {
        id: 'water_withdrawal_m3',
        label: 'Annual water withdrawal',
        kind: 'number',
        unit: 'm³',
        required: false,
      },
      {
        id: 'waste_diversion_pct',
        label: 'Share of waste diverted from landfill',
        kind: 'number',
        unit: '%',
        required: false,
      },
    ],
  },
  {
    id: 'social',
    title: 'Social & labour',
    questions: [
      {
        id: 'human_rights_policy',
        label: 'Published human rights policy?',
        kind: 'boolean',
        required: true,
      },
      {
        id: 'iso45001',
        label: 'ISO 45001 (occupational health & safety) certified?',
        kind: 'boolean',
        required: false,
      },
      {
        id: 'trir',
        label: 'Total recordable incident rate (most recent period)',
        kind: 'number',
        unit: 'per 200k hours',
        required: false,
      },
    ],
  },
  {
    id: 'governance',
    title: 'Governance',
    questions: [
      {
        id: 'code_of_conduct',
        label: 'Supplier code of conduct signed?',
        kind: 'boolean',
        required: true,
      },
      {
        id: 'anti_corruption_policy',
        label: 'Anti-corruption / anti-bribery policy in place?',
        kind: 'boolean',
        required: true,
      },
      {
        id: 'sustainability_contact',
        label: 'Sustainability contact (name and email)',
        kind: 'text',
        required: true,
      },
    ],
  },
];

export type QuestionnaireResponses = Record<string, unknown>;

export interface ValidationIssue {
  questionId: string;
  message: string;
}

export function listQuestions(): Question[] {
  return SUPPLIER_QUESTIONNAIRE.flatMap((s) => s.questions);
}

export function findQuestion(id: string): Question | undefined {
  return listQuestions().find((q) => q.id === id);
}

/** Validate a full submission. Returns [] when the submission is acceptable. */
export function validateResponses(responses: QuestionnaireResponses): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const question of listQuestions()) {
    const raw = responses[question.id];
    const provided = raw !== undefined && raw !== null && raw !== '';

    if (!provided) {
      if (question.required) {
        issues.push({ questionId: question.id, message: `${question.label} is required.` });
      }
      continue;
    }

    switch (question.kind) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) {
          issues.push({ questionId: question.id, message: `${question.label} must be a number.` });
        } else if (n < 0) {
          issues.push({ questionId: question.id, message: `${question.label} cannot be negative.` });
        } else if (question.unit === '%' && n > 100) {
          issues.push({ questionId: question.id, message: `${question.label} cannot exceed 100%.` });
        }
        break;
      }
      case 'boolean': {
        if (typeof raw !== 'boolean') {
          issues.push({ questionId: question.id, message: `${question.label} must be yes or no.` });
        }
        break;
      }
      case 'single_select': {
        const ok = question.options?.some((o) => o.value === raw);
        if (!ok) {
          issues.push({ questionId: question.id, message: `${question.label}: invalid choice.` });
        }
        break;
      }
      case 'multi_select': {
        if (!Array.isArray(raw) || raw.some((v) => !question.options?.some((o) => o.value === v))) {
          issues.push({ questionId: question.id, message: `${question.label}: invalid selection.` });
        }
        break;
      }
      case 'text':
      default:
        if (typeof raw !== 'string') {
          issues.push({ questionId: question.id, message: `${question.label} must be text.` });
        }
        break;
    }
  }

  return issues;
}

export function questionnaireCompleteness(responses: QuestionnaireResponses): number {
  const questions = listQuestions();
  if (questions.length === 0) return 0;
  const answered = questions.filter((q) => {
    const v = responses[q.id];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
  return Math.round((answered / questions.length) * 100);
}
