/**
 * Deterministic document pre-processing (ADR-005): extract plain text (and a
 * per-page split where the format supports it) BEFORE any model sees the file.
 * The parsed artifact is persisted and re-used, so extraction is auditable.
 *
 * Supported now: text/plain, text/csv, text/tab-separated-values, application/pdf
 * (embedded text via pdf-parse — lazily required so a load failure degrades
 * gracefully). OCR for scanned PDFs and DOCX/XLSX table extraction are later work.
 */

export interface ParsedDocument {
  text: string;
  pageCount: number;
  pages: Array<{ page: number; text: string }>;
  parser: string;
  truncated: boolean;
}

export const MAX_PARSED_CHARS = 200_000;

export class UnsupportedDocumentError extends Error {
  readonly code = 'document.unsupported';
  constructor(mime: string) {
    super(`Cannot extract text from "${mime}".`);
    this.name = 'UnsupportedDocumentError';
  }
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_PARSED_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_PARSED_CHARS), truncated: true };
}

export async function parseDocument(input: {
  buffer: Buffer;
  mime: string;
  filename?: string;
}): Promise<ParsedDocument> {
  const mime = input.mime.toLowerCase();

  if (mime.startsWith('text/') || mime === 'application/json') {
    const raw = input.buffer.toString('utf8');
    const { text, truncated } = clamp(raw);
    return { text, pageCount: 1, pages: [{ page: 1, text }], parser: 'utf8', truncated };
  }

  if (mime === 'application/pdf') {
    return parsePdf(input.buffer);
  }

  throw new UnsupportedDocumentError(mime);
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  let pdfParse: (b: Buffer) => Promise<{ text: string; numpages: number }>;
  try {
    // Lazy require: pdf-parse pulls pdfjs; if it fails to load we surface a clear error.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pdfParse = require('pdf-parse') as typeof pdfParse;
  } catch {
    throw new UnsupportedDocumentError('application/pdf (parser unavailable)');
  }

  const result = await pdfParse(buffer);
  // pdf-parse joins pages with \f (form feed) in older builds; fall back to a single page.
  const rawPages = result.text.split('\f');
  const pages =
    rawPages.length > 1
      ? rawPages.map((t, i) => ({ page: i + 1, text: t.trim() }))
      : [{ page: 1, text: result.text.trim() }];
  const joined = pages.map((p) => p.text).join('\n\n');
  const { text, truncated } = clamp(joined);
  return {
    text,
    pageCount: result.numpages || pages.length,
    pages: truncated ? [{ page: 1, text }] : pages,
    parser: 'pdf-parse',
    truncated,
  };
}

/** Locate a snippet in the parsed text -> a source span for a candidate. */
export interface SourceSpan {
  sourceText: string;
  charStart: number | null;
  charEnd: number | null;
  page: number | null;
}

export function locateSpan(parsed: ParsedDocument, snippet: string): SourceSpan {
  const norm = snippet.trim();
  const idx = parsed.text.indexOf(norm);
  if (idx === -1) {
    return { sourceText: norm, charStart: null, charEnd: null, page: null };
  }
  let page: number | null = null;
  for (const p of parsed.pages) {
    if (p.text.includes(norm)) {
      page = p.page;
      break;
    }
  }
  return { sourceText: norm, charStart: idx, charEnd: idx + norm.length, page };
}
