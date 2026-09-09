/** Hand-written JSON Schemas for the tool inputs (kept in sync with schemas.ts). */

export const CLASSIFICATION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    documentType: {
      type: 'string',
      enum: [
        'supplier_report',
        'certificate',
        'invoice',
        'utility_bill',
        'epd',
        'lca',
        'audit_report',
        'questionnaire',
        'other',
      ],
    },
    issuer: { type: ['string', 'null'] },
    reportingPeriod: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['documentType', 'issuer', 'reportingPeriod', 'confidence'],
  additionalProperties: false,
} as const;

export const EXTRACTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    documentType: { type: 'string' },
    issuer: { type: ['string', 'null'] },
    reportingPeriod: { type: ['string', 'null'] },
    candidates: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        properties: {
          metricKey: { type: 'string' },
          label: { type: 'string' },
          valueNumeric: { type: ['number', 'null'] },
          valueText: { type: ['string', 'null'] },
          unit: { type: ['string', 'null'] },
          reportingPeriod: { type: ['string', 'null'] },
          provenanceGuess: {
            type: 'string',
            enum: [
              'measured',
              'supplier_reported',
              'calculated',
              'estimated',
              'modeled',
              'inferred',
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
          sourceText: { type: 'string', maxLength: 600 },
          rationale: { type: 'string' },
        },
        required: [
          'metricKey',
          'label',
          'valueNumeric',
          'valueText',
          'unit',
          'confidence',
          'sourceText',
          'rationale',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['documentType', 'issuer', 'reportingPeriod', 'candidates'],
  additionalProperties: false,
} as const;

export const ASK_INTENT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'emissions_summary',
        'emissions_trend',
        'top_scope3_categories',
        'top_suppliers_by_emissions',
        'missing_evidence',
        'estimated_datapoints',
        'outdated_factors',
        'low_trust_datapoints',
        'compliance_gaps',
        'open_findings',
        'data_quality_issues',
        'unsupported',
      ],
    },
    reportingPeriod: { type: ['string', 'null'] },
    comparePeriod: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
  },
  required: ['intent', 'reportingPeriod', 'comparePeriod', 'confidence'],
  additionalProperties: false,
} as const;

export const ASK_ANSWER_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 4000 },
    citedRefs: {
      type: 'array',
      maxItems: 40,
      items: { type: 'integer', minimum: 1, maximum: 200 },
    },
  },
  required: ['answer', 'citedRefs'],
  additionalProperties: false,
} as const;
