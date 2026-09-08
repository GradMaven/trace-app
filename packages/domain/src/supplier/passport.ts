import type { Provenance } from '@trace/shared';
import {
  QUESTIONNAIRE_VERSION,
  questionnaireCompleteness,
  type QuestionnaireResponses,
} from './questionnaire';

/**
 * Supplier Passport builder (brief Module C).
 *
 * Pure: given the supplier's profile, relationship, the latest submitted
 * questionnaire, and a summary of attached evidence, produce a versioned
 * passport snapshot. Every value carries a `provenance` so the UI never renders
 * a supplier-reported figure as if it were measured or verified (Principle 3).
 *
 * Persistence, versioning, and audit are the caller's job (packages/db).
 */

export const PASSPORT_BUILDER_VERSION = 'passport-builder@1';

export interface PassportField<T = unknown> {
  value: T | null;
  provenance: Provenance | 'not_provided';
  unit?: string;
}

export interface PassportInput {
  supplier: {
    name: string;
    country: string;
    industryNace: string | null;
    status: string;
  };
  relationship: {
    category: string | null;
    tier: number | null;
    annualSpend: string | null;
    currency: string | null;
  } | null;
  questionnaire: {
    version: string;
    submittedAt: string;
    responses: QuestionnaireResponses;
  } | null;
  evidence: {
    count: number;
    verifiedCount: number;
    latestReportingPeriod: string | null;
  };
}

export interface PassportData {
  builderVersion: string;
  questionnaireVersion: string | null;
  generatedAt: string;
  completeness: number;
  identity: {
    name: PassportField<string>;
    country: PassportField<string>;
    industryNace: PassportField<string>;
    reportingPeriod: PassportField<string>;
    employeesFte: PassportField<number>;
    primaryActivity: PassportField<string>;
  };
  carbon: {
    ghgInventory: PassportField<boolean>;
    scope1: PassportField<number>;
    scope2: PassportField<number>;
    scope2Method: PassportField<string>;
    scope3Categories: PassportField<string[]>;
    renewableElectricityPct: PassportField<number>;
    reductionTarget: PassportField<boolean>;
  };
  environmental: {
    iso14001: PassportField<boolean>;
    waterWithdrawalM3: PassportField<number>;
    wasteDiversionPct: PassportField<number>;
  };
  social: {
    humanRightsPolicy: PassportField<boolean>;
    iso45001: PassportField<boolean>;
    trir: PassportField<number>;
  };
  governance: {
    codeOfConduct: PassportField<boolean>;
    antiCorruptionPolicy: PassportField<boolean>;
    sustainabilityContact: PassportField<string>;
  };
  relationship: {
    category: PassportField<string>;
    tier: PassportField<number>;
    annualSpend: PassportField<string>;
  };
  evidence: {
    attached: number;
    verified: number;
    latestReportingPeriod: string | null;
  };
}

const NOT_PROVIDED: PassportField<never> = { value: null, provenance: 'not_provided' };

function reported<T>(value: T | undefined | null, unit?: string): PassportField<T> {
  if (value === undefined || value === null || value === '') {
    return unit ? { value: null, provenance: 'not_provided', unit } : { ...NOT_PROVIDED };
  }
  return unit
    ? { value, provenance: 'supplier_reported', unit }
    : { value, provenance: 'supplier_reported' };
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildPassport(input: PassportInput): PassportData {
  const r: QuestionnaireResponses = input.questionnaire?.responses ?? {};
  const hasQ = input.questionnaire !== null;

  return {
    builderVersion: PASSPORT_BUILDER_VERSION,
    questionnaireVersion: hasQ ? (input.questionnaire?.version ?? QUESTIONNAIRE_VERSION) : null,
    generatedAt: new Date().toISOString(),
    completeness: hasQ ? questionnaireCompleteness(r) : 0,

    identity: {
      name: { value: input.supplier.name, provenance: 'supplier_reported' },
      country: { value: input.supplier.country, provenance: 'supplier_reported' },
      industryNace: reported(input.supplier.industryNace),
      reportingPeriod: reported(asString(r['reporting_period'])),
      employeesFte: reported(num(r['employees_fte']), 'FTE'),
      primaryActivity: reported(asString(r['primary_activity'])),
    },

    carbon: {
      ghgInventory: reported(asBool(r['ghg_inventory_exists'])),
      scope1: reported(num(r['scope1_tco2e']), 'tCO2e'),
      scope2: reported(num(r['scope2_tco2e']), 'tCO2e'),
      scope2Method: reported(asString(r['scope2_method'])),
      scope3Categories: reported(asStringArray(r['scope3_categories_reported'])),
      renewableElectricityPct: reported(num(r['renewable_electricity_pct']), '%'),
      reductionTarget: reported(asBool(r['reduction_target'])),
    },

    environmental: {
      iso14001: reported(asBool(r['iso14001'])),
      waterWithdrawalM3: reported(num(r['water_withdrawal_m3']), 'm³'),
      wasteDiversionPct: reported(num(r['waste_diversion_pct']), '%'),
    },

    social: {
      humanRightsPolicy: reported(asBool(r['human_rights_policy'])),
      iso45001: reported(asBool(r['iso45001'])),
      trir: reported(num(r['trir']), 'per 200k hours'),
    },

    governance: {
      codeOfConduct: reported(asBool(r['code_of_conduct'])),
      antiCorruptionPolicy: reported(asBool(r['anti_corruption_policy'])),
      sustainabilityContact: reported(asString(r['sustainability_contact'])),
    },

    relationship: {
      category: reported(input.relationship?.category ?? null),
      tier: reported(input.relationship?.tier ?? null),
      annualSpend:
        input.relationship?.annualSpend != null
          ? {
              value: input.relationship.annualSpend,
              provenance: 'measured',
              unit: input.relationship.currency ?? 'EUR',
            }
          : { ...NOT_PROVIDED },
    },

    evidence: {
      attached: input.evidence.count,
      verified: input.evidence.verifiedCount,
      latestReportingPeriod: input.evidence.latestReportingPeriod,
    },
  };
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function asStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0
    ? (v as string[])
    : null;
}
