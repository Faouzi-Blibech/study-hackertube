import { describe, expect, it } from 'vitest';
import { MAX_WORDS, chunkPages, removeBoilerplate } from './chunk';
import type { PdfLine, PdfPage } from './pdf';

const body = (text: string): PdfLine => ({ text, fontSize: 12, isHeading: false });
const head = (text: string): PdfLine => ({ text, fontSize: 20, isHeading: true });
const words = (n: number, w = 'word'): string => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const sentence = (n: number, tag: string): string => `Sentence ${tag} ${words(n - 2, 'x')}.`;
const wc = (s: string): number => s.split(/\s+/).length;

describe('removeBoilerplate', () => {
  it('drops footers repeated on more than half of the pages, ignoring page digits', () => {
    const topics = ['alpha', 'bravo', 'charlie', 'delta'];
    const pages: PdfPage[] = topics.map((t, i) => ({
      page: i + 1,
      lines: [body(`Unique content line about ${t}`), body(`CS101 Spring - Slide ${i + 1}`), body(String(i + 1))],
    }));
    const out = removeBoilerplate(pages);
    for (const p of out) {
      expect(p.lines).toHaveLength(1);
      expect(p.lines[0]!.text).toContain('Unique content');
    }
  });

  it('keeps a line that appears on only half of the pages or fewer', () => {
    const pages: PdfPage[] = [
      { page: 1, lines: [body('Shared note here')] },
      { page: 2, lines: [body('Other thing')] },
    ];
    expect(removeBoilerplate(pages)[0]!.lines).toHaveLength(1);
  });
});

describe('chunkPages', () => {
  it('attaches the nearest heading and starts a new chunk at each heading', () => {
    const pages: PdfPage[] = [
      {
        page: 1,
        lines: [head('Introduction'), body(sentence(20, 'a')), head('MapReduce'), body(sentence(20, 'b'))],
      },
      { page: 2, lines: [body(sentence(20, 'c'))] },
    ];
    const chunks = chunkPages(pages);
    expect(chunks.map((c) => c.heading)).toEqual(['Introduction', 'MapReduce']);
    expect(chunks[1]!.text).toContain('Sentence b');
    expect(chunks[1]!.text).toContain('Sentence c'); // continues across the page break
    expect(chunks[1]!.page).toBe(1);
    expect(chunks.map((c) => c.id)).toEqual([0, 1]);
  });

  it('merges consecutive heading lines into one heading', () => {
    const chunks = chunkPages([{ page: 1, lines: [head('Chapter 3'), head('Sorting Algorithms'), body(sentence(30, 'z'))] }]);
    expect(chunks[0]!.heading).toBe('Chapter 3 Sorting Algorithms');
  });

  it('keeps chunks under the word budget and breaks on sentence boundaries', () => {
    const text = Array.from({ length: 60 }, (_, i) => sentence(25, String(i))).join(' ');
    const chunks = chunkPages([{ page: 1, lines: [body(text)] }]);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(wc(c.text)).toBeLessThanOrEqual(MAX_WORDS);
      expect(c.text.trim().endsWith('.')).toBe(true);
      expect(c.text).toMatch(/^Sentence/);
    }
  });

  it('splits a single enormous sentence by words rather than exceeding the budget', () => {
    const chunks = chunkPages([{ page: 1, lines: [body(words(900) + '.')] }]);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) expect(wc(c.text)).toBeLessThanOrEqual(MAX_WORDS);
  });

  it('never emits empty or near-empty chunks (page numbers, tiny scraps)', () => {
    const pages: PdfPage[] = [
      { page: 1, lines: [body('1'), head('Title Only')] },
      { page: 2, lines: [head('Agenda'), body('Short bit'), head('Real Section'), body(sentence(40, 'r')), body('2')] },
    ];
    const chunks = chunkPages(pages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('Real Section');
    for (const c of chunks) expect(c.text.trim().length).toBeGreaterThan(0);
  });

  it('joins hyphenated line breaks', () => {
    const chunks = chunkPages([
      { page: 1, lines: [body('Data is distrib-'), body(`uted across many machines in the cluster and ${words(10)}.`)] },
    ]);
    expect(chunks[0]!.text).toContain('distributed across');
  });
});
