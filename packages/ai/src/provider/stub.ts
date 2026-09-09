import type { z } from 'zod';
import type { AIProvider, StructuredRequest, StructuredResult } from '../types';
import {
  CLASSIFICATION_DOC_TYPES,
  type AskAnswerResult,
  type AskIntent,
  type AskIntentResult,
  type CandidateOutput,
  type ClassificationResult,
  type ExtractionResult,
} from '../schemas';

/**
 * Deterministic development provider (ADR-005, "no fake AI").
 *
 * This is NOT a mock of Claude — it is a small, honest heuristic capability used
 * when no AI provider is configured, so the whole ingestion → review pipeline is
 * exercisable end to end without an API key. Every AIJob it produces is stamped
 * `provider: 'stub'`, `model: 'stub-heuristic@1'`, so it is never mistaken for
 * model output. Confidence is deliberately modest.
 */
export const STUB_MODEL = 'stub-heuristic@1';

export class StubAIProvider implements AIProvider {
  readonly kind = 'stub' as const;

  async extractStructured<T extends z.ZodTypeAny>(
    req: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const start = Date.now();
    const text = req.userContent;

    let output: unknown;
    let confidence: number;
    if (req.capability === 'classification') {
      output = classify(text);
      confidence = (output as ClassificationResult).confidence;
    } else if (req.capability === 'nl_analytics') {
      if (req.toolName === 'record_intent') {
        output = classifyIntent(text);
        confidence = (output as AskIntentResult).confidence;
      } else {
        output = composeAnswer(text);
        confidence = (output as AskAnswerResult).citedRefs.length > 0 ? 55 : 20;
      }
    } else {
      output = extract(text);
      confidence = meanConfidence((output as ExtractionResult).candidates);
    }

    const parsed = req.outputSchema.safeParse(output);
    if (!parsed.success) {
      throw new Error(
        `Stub provider produced output that does not match the schema: ${parsed.error.message}`,
      );
    }

    return {
      output: parsed.data,
      provider: 'stub',
      model: STUB_MODEL,
      tokensIn: 0,
      tokensOut: 0,
      costEur: 0,
      latencyMs: Date.now() - start,
      confidence,
    };
  }
}

function meanConfidence(candidates: CandidateOutput[]): number {
  if (candidates.length === 0) return 30;
  return Math.round(candidates.reduce((a, c) => a + c.confidence, 0) / candidates.length);
}

// --- classification -------------------------------------------------------

function classify(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const scores: Record<(typeof CLASSIFICATION_DOC_TYPES)[number], number> = {
    supplier_report: count(lower, [
      'sustainability report',
      'annual report',
      'esg report',
      'scope 1',
      'scope 3',
    ]),
    certificate: count(lower, ['certificate', 'is certified', 'certification', 'accredited']),
    invoice: count(lower, ['invoice', 'amount due', 'bill to', 'vat']),
    utility_bill: count(lower, ['utility', 'kwh used', 'meter reading', 'electricity bill']),
    epd: count(lower, ['environmental product declaration', 'epd', 'iso 14025']),
    lca: count(lower, ['life cycle assessment', 'life-cycle assessment', 'lca', 'cradle-to-gate']),
    audit_report: count(lower, [
      'audit report',
      'assurance statement',
      'auditor',
      'limited assurance',
    ]),
    questionnaire: count(lower, ['questionnaire', 'please answer', 'question 1']),
    other: 0,
  };
  let best: (typeof CLASSIFICATION_DOC_TYPES)[number] = 'other';
  let bestScore = 0;
  for (const t of CLASSIFICATION_DOC_TYPES) {
    if (scores[t] > bestScore) {
      best = t;
      bestScore = scores[t];
    }
  }
  const issuer = matchFirst(text, [
    /(?:published|prepared|issued)\s+by\s+([A-Z][\w .,&-]{2,80})/,
    /^([A-Z][\w .,&-]{2,60})\s+(?:Sustainability|Annual|ESG)\s+Report/m,
  ]);
  const reportingPeriod =
    matchFirst(text, [
      /\bFY\s?(\d{4})\b/i,
      /reporting (?:year|period)[^\n]{0,30}?(\d{4})/i,
    ])?.replace(/^/, (m) => (/^\d{4}$/.test(m) ? 'FY' : '')) ?? null;

  return {
    documentType: bestScore === 0 ? 'other' : best,
    issuer: issuer ? issuer.trim() : null,
    reportingPeriod: normalisePeriod(reportingPeriod),
    confidence: bestScore === 0 ? 20 : Math.min(70, 35 + bestScore * 8),
  };
}

// --- extraction ---------------------------------------------------------

interface Rule {
  metricKey: string;
  label: string;
  unit: string | null;
  numeric: boolean;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    metricKey: 'scope1_tco2e',
    label: 'Scope 1 emissions',
    unit: 'tCO2e',
    numeric: true,
    patterns: [/scope[\s ]*1[^\n]{0,80}?([\d][\d.,]*)\s*(kt?CO2e|t\s?CO2e|tonnes?\s*CO2e)/i],
  },
  {
    metricKey: 'scope2_location_tco2e',
    label: 'Scope 2 emissions (location-based)',
    unit: 'tCO2e',
    numeric: true,
    patterns: [/scope[\s ]*2[^\n]{0,40}?location[^\n]{0,40}?([\d][\d.,]*)\s*(kt?CO2e|t\s?CO2e)/i],
  },
  {
    metricKey: 'scope2_market_tco2e',
    label: 'Scope 2 emissions (market-based)',
    unit: 'tCO2e',
    numeric: true,
    patterns: [/scope[\s ]*2[^\n]{0,40}?market[^\n]{0,40}?([\d][\d.,]*)\s*(kt?CO2e|t\s?CO2e)/i],
  },
  {
    metricKey: 'scope3_tco2e',
    label: 'Scope 3 emissions',
    unit: 'tCO2e',
    numeric: true,
    patterns: [/scope[\s ]*3[^\n]{0,80}?([\d][\d.,]*)\s*(kt?CO2e|t\s?CO2e|tonnes?\s*CO2e)/i],
  },
  {
    metricKey: 'renewable_electricity_pct',
    label: 'Renewable electricity share',
    unit: '%',
    numeric: true,
    patterns: [
      /renewable[^\n]{0,50}?([\d][\d.,]*)\s*%/i,
      /([\d][\d.,]*)\s*%[^\n]{0,30}?renewable/i,
    ],
  },
  {
    metricKey: 'energy_consumption_mwh',
    label: 'Total energy consumption',
    unit: 'MWh',
    numeric: true,
    patterns: [/energy (?:consumption|use)[^\n]{0,50}?([\d][\d.,]*)\s*(MWh|GWh)/i],
  },
  {
    metricKey: 'water_withdrawal_m3',
    label: 'Water withdrawal',
    unit: 'm3',
    numeric: true,
    patterns: [/water (?:withdrawal|consumption|use)[^\n]{0,50}?([\d][\d.,]*)\s*(m3|m³)/i],
  },
  {
    metricKey: 'iso14001_certified',
    label: 'ISO 14001 certified',
    unit: null,
    numeric: false,
    patterns: [/ISO\s*14001/i],
  },
  {
    metricKey: 'iso45001_certified',
    label: 'ISO 45001 certified',
    unit: null,
    numeric: false,
    patterns: [/ISO\s*45001/i],
  },
  {
    metricKey: 'reduction_target_exists',
    label: 'Emissions reduction target',
    unit: null,
    numeric: false,
    patterns: [/(reduction target|science[- ]based target|net[- ]?zero|SBTi)/i],
  },
];

function extract(text: string): ExtractionResult {
  const classification = classify(text);
  const candidates: CandidateOutput[] = [];

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = pattern.exec(text);
      if (!m) continue;
      const snippet = sentenceAround(text, m.index, m[0].length);
      if (rule.numeric) {
        const value = parseNumber(m[1] ?? '');
        if (value === null) continue;
        candidates.push({
          metricKey: rule.metricKey,
          label: rule.label,
          valueNumeric: value,
          valueText: null,
          unit: (m[2] as string | undefined)?.replace(/\s/g, '') ?? rule.unit,
          reportingPeriod: classification.reportingPeriod,
          provenanceGuess: 'supplier_reported',
          confidence: 55,
          sourceText: snippet,
          rationale: `Heuristic match for ${rule.label.toLowerCase()}.`,
        });
      } else {
        candidates.push({
          metricKey: rule.metricKey,
          label: rule.label,
          valueNumeric: null,
          valueText: 'true',
          unit: null,
          reportingPeriod: classification.reportingPeriod,
          provenanceGuess: 'supplier_reported',
          confidence: 45,
          sourceText: snippet,
          rationale: `Heuristic match for "${rule.label}".`,
        });
      }
      break;
    }
  }

  return {
    documentType: classification.documentType,
    issuer: classification.issuer,
    reportingPeriod: classification.reportingPeriod,
    candidates,
  };
}

// --- Ask TRACE (nl_analytics) --------------------------------------------

const INTENT_KEYWORDS: Array<{ intent: AskIntent; needles: RegExp[] }> = [
  {
    intent: 'emissions_trend',
    needles: [
      /\btrend\b/i,
      /over time/i,
      /year[- ]on[- ]year/i,
      /\bincrease\b/i,
      /\bdecrease\b/i,
      /changed?/i,
      /compared? to/i,
      /vs\.? *fy/i,
    ],
  },
  {
    intent: 'top_suppliers_by_emissions',
    needles: [/suppliers?.*(contribute|emissions|most|biggest|largest)/i, /which suppliers/i],
  },
  {
    intent: 'top_scope3_categories',
    needles: [/scope *3.*(categor|breakdown|largest|biggest)/i, /which.*categor/i],
  },
  {
    intent: 'missing_evidence',
    needles: [
      /missing .{0,20}evidence/i,
      /no .{0,25}evidence/i,
      /without .{0,15}evidence/i,
      /unsupported datapoints?/i,
      /lack.{0,20}evidence/i,
      /not .{0,15}evidenced/i,
      /evidence.{0,15}(gap|missing)/i,
    ],
  },
  {
    intent: 'estimated_datapoints',
    needles: [/estimated?/i, /modell?ed/i, /inferred/i, /not measured/i, /assumptions?/i],
  },
  {
    intent: 'outdated_factors',
    needles: [
      /outdated (emission )?factors?/i,
      /expired factors?/i,
      /factor.*validity/i,
      /old factors?/i,
    ],
  },
  {
    intent: 'low_trust_datapoints',
    needles: [/low trust/i, /trust score/i, /least trustworthy/i, /weakest (data|numbers?)/i],
  },
  {
    intent: 'compliance_gaps',
    needles: [
      /compliance gaps?/i,
      /esrs/i,
      /disclosures?/i,
      /csrd/i,
      /requirements? (not|missing|incomplete)/i,
    ],
  },
  { intent: 'open_findings', needles: [/findings?/i, /audit readiness/i, /remediat/i] },
  {
    intent: 'data_quality_issues',
    needles: [/data[- ]quality/i, /anomal/i, /quality issues?/i, /duplicate/i],
  },
  {
    intent: 'emissions_summary',
    needles: [
      /scope *[123]/i,
      /emissions?/i,
      /\btco2e\b/i,
      /carbon footprint/i,
      /ghg/i,
      /total emissions?/i,
    ],
  },
];

function classifyIntent(text: string): AskIntentResult {
  const question = text.replace(/^QUESTION:\s*/i, '');
  let intent: AskIntent = 'unsupported';
  for (const rule of INTENT_KEYWORDS) {
    if (rule.needles.some((n) => n.test(question))) {
      intent = rule.intent;
      break;
    }
  }
  const periods = [...question.matchAll(/\bFY\s?(\d{4})\b/gi)].map((m) => `FY${m[1]}`);
  return {
    intent,
    reportingPeriod: periods[0] ?? null,
    comparePeriod: periods[1] ?? null,
    confidence: intent === 'unsupported' ? 20 : 55,
  };
}

function composeAnswer(text: string): AskAnswerResult {
  const question = (text.match(/QUESTION:\s*([\s\S]*?)\n\nRECORDS/i)?.[1] ?? '').trim();
  const recordLines = [...text.matchAll(/^\[(\d+)\]\s*(.+)$/gm)];
  if (recordLines.length === 0) {
    return {
      answer: 'I could not find any records in this workspace that answer that question.',
      citedRefs: [],
    };
  }
  const shown = recordLines.slice(0, 6);
  const body = shown.map((m) => `${m[2]!.trim()} [${m[1]}]`).join('; ');
  const more =
    recordLines.length > shown.length ? ` (+${recordLines.length - shown.length} more)` : '';
  return {
    answer: `From ${recordLines.length} matching record${recordLines.length === 1 ? '' : 's'}${
      question ? ` for "${question.slice(0, 120)}"` : ''
    }: ${body}${more}.`,
    citedRefs: shown.map((m) => Number(m[1])),
  };
}

// --- helpers ----------------------------------------------------------

function count(haystack: string, needles: string[]): number {
  return needles.reduce((n, s) => (haystack.includes(s) ? n + 1 : n), 0);
}

function matchFirst(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[1] ?? m[0];
  }
  return null;
}

function normalisePeriod(v: string | null): string | null {
  if (!v) return null;
  const m = /(\d{4})/.exec(v);
  return m ? `FY${m[1]}` : v;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', index) + 1);
  let end = text.indexOf('\n', index + length);
  if (end === -1) end = Math.min(text.length, index + length + 120);
  return text.slice(start, end).trim().slice(0, 200);
}
