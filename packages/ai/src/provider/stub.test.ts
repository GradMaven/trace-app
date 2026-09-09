import { describe, expect, it } from 'vitest';
import { classifyDocument } from '../capabilities/classify';
import { extractDatapoints } from '../capabilities/extract';
import { classifyAskIntent, composeAskAnswer } from '../capabilities/ask';
import { StubAIProvider } from './stub';

const REPORT = `NordWerk Manufacturing AG Sustainability Report 2025

Prepared by NordWerk Manufacturing AG.
Reporting year: 2025.

Our Scope 1 emissions were 1,303 tCO2e.
Scope 2 (market-based) emissions: 3,100 tCO2e.
Scope 3 emissions totalled 2,719 tCO2e.
Renewable electricity share reached 48%.
All German sites are ISO 14001 certified.
We have a science-based target to halve emissions by 2030.
`;

const provider = new StubAIProvider();

describe('StubAIProvider — classification', () => {
  it('recognises a supplier report and its issuer/period', async () => {
    const res = await classifyDocument(provider, { text: REPORT, filename: 'report.txt' });
    expect(res.provider).toBe('stub');
    expect(res.model).toBe('stub-heuristic@1');
    expect(res.output.documentType).toBe('supplier_report');
    expect(res.output.reportingPeriod).toBe('FY2025');
  });

  it('falls back to "other" for unrelated text', async () => {
    const res = await classifyDocument(provider, { text: 'Lorem ipsum dolor sit amet.' });
    expect(res.output.documentType).toBe('other');
    expect(res.output.confidence).toBeLessThan(30);
  });
});

describe('StubAIProvider — extraction', () => {
  it('extracts schema-valid candidates with verbatim source snippets', async () => {
    const res = await extractDatapoints(provider, { text: REPORT });
    const keys = res.output.candidates.map((c) => c.metricKey);
    expect(keys).toContain('scope1_tco2e');
    expect(keys).toContain('scope2_market_tco2e');
    expect(keys).toContain('scope3_tco2e');
    expect(keys).toContain('renewable_electricity_pct');
    expect(keys).toContain('iso14001_certified');
    expect(keys).toContain('reduction_target_exists');

    const scope1 = res.output.candidates.find((c) => c.metricKey === 'scope1_tco2e')!;
    expect(scope1.valueNumeric).toBe(1303);
    expect(scope1.unit).toBe('tCO2e');
    expect(REPORT).toContain(scope1.sourceText);
  });

  it('returns no candidates when the text has none', async () => {
    const res = await extractDatapoints(provider, {
      text: 'A memo about the office coffee machine.',
    });
    expect(res.output.candidates).toEqual([]);
  });

  it('is deterministic', async () => {
    const a = await extractDatapoints(provider, { text: REPORT });
    const b = await extractDatapoints(provider, { text: REPORT });
    expect(a.output).toEqual(b.output);
  });
});

describe('StubAIProvider — Ask TRACE (nl_analytics)', () => {
  it('routes questions to a fixed intent and pulls out periods', async () => {
    const cases: Array<[string, string]> = [
      ['What were our Scope 3 emissions in FY2025?', 'emissions_summary'],
      ['Why did emissions increase versus FY2024?', 'emissions_trend'],
      ['Which suppliers contribute the most emissions?', 'top_suppliers_by_emissions'],
      ['Show datapoints with no supporting evidence', 'missing_evidence'],
      ['Which figures are estimated rather than measured?', 'estimated_datapoints'],
      ['Do any calculations use an outdated emission factor?', 'outdated_factors'],
      ['Which ESRS disclosures are still incomplete?', 'compliance_gaps'],
      ['What is the capital of France?', 'unsupported'],
    ];
    for (const [question, intent] of cases) {
      const res = await classifyAskIntent(provider, { question });
      expect(res.provider).toBe('stub');
      expect(res.output.intent).toBe(intent);
    }
    const withPeriod = await classifyAskIntent(provider, {
      question: 'Compare Scope 1 for FY2025 vs FY2024',
    });
    expect(withPeriod.output.reportingPeriod).toBe('FY2025');
    expect(withPeriod.output.comparePeriod).toBe('FY2024');
  });

  it('composes an answer only from the numbered records and cites them', async () => {
    const records = [
      { ref: 1, kind: 'emission', title: 'Scope 1', detail: '1303 tCO2e' },
      { ref: 2, kind: 'emission', title: 'Scope 3', detail: '2719 tCO2e' },
    ];
    const res = await composeAskAnswer(provider, {
      question: 'What are our emissions?',
      intent: 'emissions_summary',
      records,
    });
    expect(res.output.answer).toContain('1303 tCO2e');
    expect(res.output.answer).toContain('2719 tCO2e');
    expect(res.output.citedRefs.sort()).toEqual([1, 2]);
  });

  it('says so plainly when there are no records', async () => {
    const res = await composeAskAnswer(provider, {
      question: 'Which suppliers contribute most?',
      intent: 'top_suppliers_by_emissions',
      records: [],
    });
    expect(res.output.citedRefs).toEqual([]);
    expect(res.output.answer.toLowerCase()).toContain('could not find');
  });
});
