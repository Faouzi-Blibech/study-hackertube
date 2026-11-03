// Pure function: extracted pages -> chunks for embedding.
// bge-small accepts 512 tokens; ~350 English words is about 470 tokens, so we cap at
// MAX_WORDS and aim for TARGET_WORDS. Chunks break on headings first, then on sentence
// boundaries; a single over-long sentence is split by words as a last resort.
import type { PdfChunk } from './types';
import type { PdfPage } from './pdf';

export const TARGET_WORDS = 300;
export const MAX_WORDS = 350;
export const MIN_WORDS = 8;

const countWords = (s: string): number => (s.trim() === '' ? 0 : s.trim().split(/\s+/).length);

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

const PAGE_NUMBER = /^(page\s+)?\d{1,4}(\s*(\/|of)\s*\d{1,4})?$/i;

/**
 * Remove lines that carry no content: bare page numbers and any line (header, footer,
 * slide footer) that repeats, ignoring digits, on more than half of the pages.
 */
export function removeBoilerplate(pages: PdfPage[]): PdfPage[] {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const key of new Set(p.lines.map((l) => normalizeKey(l.text)))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const repeated = (key: string): boolean => pages.length >= 2 && (counts.get(key) ?? 0) / pages.length > 0.5;
  return pages.map((p) => ({
    page: p.page,
    lines: p.lines.filter((l) => !PAGE_NUMBER.test(l.text.trim()) && !repeated(normalizeKey(l.text))),
  }));
}

interface Unit {
  text: string;
  page: number;
}

const BULLET = /^([-*•●▪‣]|\d+[.)]|[a-z][.)])\s+/;

/** Split a paragraph of running text into sentences. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])["')\]]*\s+(?=["'(\[]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function splitByWords(text: string, max: number): string[] {
  const words = text.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += max) out.push(words.slice(i, i + max).join(' '));
  return out;
}

/** Turn body lines of one page into sentence-like units (bullets and short lines are units too). */
function linesToUnits(lines: string[], page: number): Unit[] {
  const units: Unit[] = [];
  let para = '';
  const flush = (): void => {
    if (para.trim() === '') return;
    for (const s of splitSentences(para)) units.push({ text: s, page });
    para = '';
  };
  for (const line of lines) {
    if (BULLET.test(line)) flush();
    // Join hyphenated line breaks: "distrib-" + "uted" -> "distributed".
    para = /[A-Za-z]-$/.test(para) ? para.slice(0, -1) + line : para === '' ? line : `${para} ${line}`;
    // Short line that does not end a sentence is likely a slide bullet: keep as its own unit.
    if (line.length < 45 && !/[,;:-]$/.test(line) && BULLET.test(line)) flush();
  }
  flush();
  return units;
}

/** Text that should be embedded for a chunk: heading plus body. */
export function chunkEmbeddingText(chunk: PdfChunk): string {
  return chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text;
}

export function chunkPages(input: PdfPage[]): PdfChunk[] {
  const pages = removeBoilerplate(input);
  const chunks: PdfChunk[] = [];
  let heading: string | null = null;
  let buf: Unit[] = [];
  let bufWords = 0;
  let afterHeading = false;

  const flush = (): void => {
    if (buf.length === 0) return;
    const text = buf.map((u) => u.text).join(' ').replace(/\s+/g, ' ').trim();
    if (countWords(text) >= MIN_WORDS) {
      chunks.push({ id: chunks.length, page: buf[0]!.page, heading, text });
    }
    buf = [];
    bufWords = 0;
  };

  const push = (unit: Unit): void => {
    for (const piece of countWords(unit.text) > MAX_WORDS ? splitByWords(unit.text, MAX_WORDS) : [unit.text]) {
      const w = countWords(piece);
      if (bufWords > 0 && (bufWords + w > MAX_WORDS || (bufWords >= TARGET_WORDS * 0.8 && bufWords + w > TARGET_WORDS))) {
        flush();
      }
      buf.push({ text: piece, page: unit.page });
      bufWords += w;
    }
  };

  for (const p of pages) {
    let body: string[] = [];
    const drain = (): void => {
      for (const u of linesToUnits(body, p.page)) push(u);
      body = [];
    };
    for (const line of p.lines) {
      if (line.isHeading) {
        drain();
        flush();
        // Consecutive heading lines form one multi-line title.
        heading = afterHeading && heading ? `${heading} ${line.text}` : line.text;
        afterHeading = true;
      } else {
        afterHeading = false;
        body.push(line.text);
      }
    }
    drain();
    afterHeading = false;
  }
  flush();
  return chunks;
}
