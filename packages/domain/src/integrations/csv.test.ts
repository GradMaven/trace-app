import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseDelimited } from './csv';

describe('parseDelimited', () => {
  it('parses a simple comma file with a header', () => {
    const { headers, rows } = parseDelimited('a,b,c\n1,2,3\n4,5,6\n');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields with embedded commas, quotes and newlines', () => {
    const text = 'name,note\n"Acme, Inc.","He said ""hi""\nsecond line"\n';
    const { rows } = parseDelimited(text);
    expect(rows[0]).toEqual(['Acme, Inc.', 'He said "hi"\nsecond line']);
  });

  it('handles CRLF line endings and a UTF-8 BOM', () => {
    const { headers, rows } = parseDelimited('﻿a,b\r\n1,2\r\n');
    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', '2']]);
  });

  it('drops fully-empty trailing lines', () => {
    const { rows } = parseDelimited('a,b\n1,2\n\n\n');
    expect(rows).toEqual([['1', '2']]);
  });

  it('auto-detects tab and semicolon delimiters', () => {
    expect(detectDelimiter('a\tb\tc\n')).toBe('\t');
    expect(detectDelimiter('a;b;c\n')).toBe(';');
    expect(parseDelimited('a\tb\n1\t2\n').rows).toEqual([['1', '2']]);
  });

  it('respects an explicit delimiter', () => {
    expect(parseDelimited('a|b\n1|2\n', '|').rows).toEqual([['1', '2']]);
  });
});
