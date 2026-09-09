/**
 * A tiny, dependency-free delimited-text parser (RFC 4180-ish). Handles quoted
 * fields, escaped quotes (`""`), embedded delimiters and newlines inside quotes,
 * CRLF or LF line endings, and a leading UTF-8 BOM. Pure.
 */

export type Delimiter = ',' | '\t' | ';' | '|';

export interface ParsedDelimited {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
}

/** Sniff the delimiter from the first non-empty line. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts: Record<Delimiter, number> = {
    ',': (firstLine.match(/,/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
    ';': (firstLine.match(/;/g) ?? []).length,
    '|': (firstLine.match(/\|/g) ?? []).length,
  };
  let best: Delimiter = ',';
  for (const d of ['\t', ';', '|', ','] as Delimiter[]) {
    if (counts[d] > counts[best]) best = d;
  }
  return best;
}

export function parseDelimited(text: string, delimiter?: Delimiter): ParsedDelimited {
  const src = text.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(src);

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i += 1;
      pushRecord();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Trailing field / record (unless the file ended exactly on a newline).
  if (field.length > 0 || record.length > 0) pushRecord();

  // Drop fully-empty records (e.g. a trailing blank line).
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty, delimiter: delim };
}
