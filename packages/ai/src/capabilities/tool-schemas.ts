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
            enum: ['measured', 'supplier_reported', 'calculated', 'estimated', 'modeled', 'inferred'],
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
