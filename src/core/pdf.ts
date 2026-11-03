// Text extraction from a PDF, in the browser, with pdfjs-dist. No canvas, no rendering.
// The text-processing part (itemsToLines, markHeadings) is pure so it can be tested in node.

/** A positioned run of text, the subset of pdfjs TextItem we need. */
export interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
}

export interface PdfLine {
  text: string;
  fontSize: number;
  isHeading: boolean;
}

export interface PdfPage {
  page: number; // 1-based
  lines: PdfLine[];
}

/** Minimal structural types so this file does not depend on one pdfjs build. */
interface PdfTextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
interface PdfPageLike {
  getTextContent(): Promise<{ items: ReadonlyArray<unknown> }>;
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

function isTextItem(item: unknown): item is PdfTextItemLike {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item;
}

export function toRawItems(items: ReadonlyArray<unknown>): RawTextItem[] {
  const out: RawTextItem[] = [];
  for (const it of items) {
    if (!isTextItem(it)) continue;
    const t = it.transform;
    const fontSize = Math.hypot(t[2] ?? 0, t[3] ?? 0) || it.height || 0;
    out.push({ str: it.str, x: t[4] ?? 0, y: t[5] ?? 0, width: it.width, fontSize });
  }
  return out;
}

/** Group text items into visual lines (same baseline), left to right, top to bottom. */
export function itemsToLines(items: RawTextItem[]): { text: string; fontSize: number }[] {
  const real = items.filter((i) => i.str.trim() !== '' || i.str === ' ');
  const rows: RawTextItem[][] = [];
  for (const item of real) {
    const row = rows.find((r) => {
      const ref = r[0]!;
      return Math.abs(ref.y - item.y) <= Math.max(1, 0.4 * Math.min(ref.fontSize, item.fontSize || ref.fontSize));
    });
    if (row) row.push(item);
    else rows.push([item]);
  }
  rows.sort((a, b) => b[0]!.y - a[0]!.y); // PDF y grows upwards
  const lines: { text: string; fontSize: number }[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd: number | null = null;
    let fontSize = 0;
    for (const it of row) {
      if (it.str.trim() !== '') fontSize = Math.max(fontSize, it.fontSize);
      const gap = prevEnd === null ? 0 : it.x - prevEnd;
      if (text !== '' && !text.endsWith(' ') && !it.str.startsWith(' ') && gap > 0.15 * (it.fontSize || 10)) {
        text += ' ';
      }
      text += it.str;
      prevEnd = it.x + it.width;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text !== '') lines.push({ text, fontSize });
  }
  return lines;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'with', 'vs', 'at', 'by', 'is']);

/** Short line in title case or all caps without sentence punctuation. */
export function looksLikeTitle(text: string): boolean {
  const words = text.split(/\s+/);
  if (words.length > 8 || text.length > 70 || /[.,;:!?]$/.test(text)) return false;
  if (!/[A-Za-z]{3}/.test(text)) return false;
  const significant = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()) && /[A-Za-z]/.test(w));
  if (significant.length === 0) return false;
  const capitalized = significant.filter((w) => /^[^a-z]*[A-Z]/.test(w)).length;
  return capitalized === significant.length && words.length >= 2;
}

/**
 * Flag heading lines. A line is a heading when its font is clearly larger than the
 * page's median (body) size, or when it is a short title-case line at body size.
 * The median is taken over all pages so slides with few lines still work.
 */
export function markHeadings(pages: { page: number; lines: { text: string; fontSize: number }[] }[]): PdfPage[] {
  const sizes: number[] = [];
  for (const p of pages) for (const l of p.lines) for (let i = 0; i < Math.min(l.text.length, 200); i += 20) sizes.push(l.fontSize);
  const body = median(sizes.filter((s) => s > 0));
  return pages.map((p) => ({
    page: p.page,
    lines: p.lines.map((l) => {
      const larger = body > 0 && l.fontSize >= body * 1.15 && l.text.split(/\s+/).length <= 14 && !/[.]$/.test(l.text);
      return { text: l.text, fontSize: l.fontSize, isHeading: larger || looksLikeTitle(l.text) };
    }),
  }));
}

/** Extract every page of an already opened document. */
export async function extractPagesFromDocument(doc: PdfDocumentLike): Promise<PdfPage[]> {
  const raw: { page: number; lines: { text: string; fontSize: number }[] }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    raw.push({ page: n, lines: itemsToLines(toRawItems(content.items)) });
  }
  return markHeadings(raw);
}

/** Browser entry: read a File and extract its pages. The PDF never leaves the machine. */
export async function extractPdf(file: File): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  try {
    return await extractPagesFromDocument(await task.promise);
  } finally {
    await task.destroy();
  }
}
