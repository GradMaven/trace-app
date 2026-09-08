import { describe, expect, it } from 'vitest';
import { classifyDocument } from '../capabilities/classify';
import { extractDatapoints } from '../capabilities/extract';
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
    const res = await extractDatapoints(provider, { text: 'A memo about the office coffee machine.' });
    expect(res.output.candidates).toEqual([]);
  });

  it('is deterministic', async () => {
    const a = await extractDatapoints(provider, { text: REPORT });
    const b = await extractDatapoints(provider, { text: REPORT });
    expect(a.output).toEqual(b.output);
  });
});
