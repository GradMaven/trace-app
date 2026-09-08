import { describe, expect, it } from 'vitest';
import { locateSpan, parseDocument, UnsupportedDocumentError } from './document';

describe('parseDocument', () => {
  it('parses plain text', async () => {
    const parsed = await parseDocument({
      buffer: Buffer.from('Hello\nScope 1: 100 tCO2e'),
      mime: 'text/plain',
    });
    expect(parsed.text).toContain('Scope 1: 100 tCO2e');
    expect(parsed.pageCount).toBe(1);
    expect(parsed.parser).toBe('utf8');
  });

  it('parses csv as text', async () => {
    const parsed = await parseDocument({
      buffer: Buffer.from('metric,value\nscope1,100'),
      mime: 'text/csv',
    });
    expect(parsed.text).toContain('scope1,100');
  });

  it('rejects an unsupported type', async () => {
    await expect(
      parseDocument({ buffer: Buffer.from('x'), mime: 'application/zip' }),
    ).rejects.toBeInstanceOf(UnsupportedDocumentError);
  });
});

describe('locateSpan', () => {
  it('finds the char range and page for a snippet', async () => {
    const parsed = await parseDocument({
      buffer: Buffer.from('line one\nScope 1: 100 tCO2e\nline three'),
      mime: 'text/plain',
    });
    const span = locateSpan(parsed, 'Scope 1: 100 tCO2e');
    expect(span.charStart).toBe(9);
    expect(span.charEnd).toBe(27);
    expect(span.page).toBe(1);
  });

  it('returns nulls when the snippet is absent', async () => {
    const parsed = await parseDocument({ buffer: Buffer.from('abc'), mime: 'text/plain' });
    expect(locateSpan(parsed, 'xyz')).toEqual({
      sourceText: 'xyz',
      charStart: null,
      charEnd: null,
      page: null,
    });
  });
});
