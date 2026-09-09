import { describe, expect, it } from 'vitest';
import { buildExportManifest, EXPORT_FORMAT, EXPORT_SECTIONS } from './export-bundle';

describe('buildExportManifest', () => {
  it('sorts sections, totals records, and stamps the format + disclaimer', () => {
    const m = buildExportManifest({
      organizationId: 'org_1',
      generatedAt: new Date('2026-06-01T00:00:00Z'),
      sections: [
        { section: 'evidence', count: 12 },
        { section: 'activity_data', count: 40 },
        { section: 'audit_log', count: 200 },
      ],
    });
    expect(m.format).toBe(EXPORT_FORMAT);
    expect(m.sections.map((s) => s.section)).toEqual(['activity_data', 'audit_log', 'evidence']);
    expect(m.totalRecords).toBe(252);
    expect(m.reportingPeriod).toBeNull();
    expect(m.disclaimer).toMatch(/not an assurance/i);
  });

  it('carries a reporting-period filter when given', () => {
    const m = buildExportManifest({
      organizationId: 'org_1',
      generatedAt: new Date(),
      reportingPeriod: 'FY2025',
      sections: [],
    });
    expect(m.reportingPeriod).toBe('FY2025');
    expect(m.totalRecords).toBe(0);
  });

  it('the section catalogue excludes nothing lineage-bearing by mistake', () => {
    expect(EXPORT_SECTIONS).toContain('evidence');
    expect(EXPORT_SECTIONS).toContain('calculations');
    expect(EXPORT_SECTIONS).toContain('audit_log');
    expect(new Set(EXPORT_SECTIONS).size).toBe(EXPORT_SECTIONS.length);
  });
});
