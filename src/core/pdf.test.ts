// Node smoke test: the legacy pdfjs build runs in node; the browser entry (extractPdf) is not tested here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPagesFromDocument, itemsToLines, looksLikeTitle, markHeadings } from './pdf';

describe('extractPagesFromDocument (legacy build, fixture PDF)', () => {
  it('extracts text per page and flags the large-font lines as headings', async () => {
    const data = new Uint8Array(readFileSync(resolve(import.meta.dirname, '__fixtures__/two-pages.pdf')));
    const task = getDocument({ data });
    const pages = await extractPagesFromDocument(await task.promise);
    await task.destroy();

    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0]!.lines.map((l) => l.text)).toEqual([
      'Introduction to MapReduce',
      'MapReduce splits work across many machines.',
      'Each mapper emits key value pairs.',
    ]);
    expect(pages[1]!.lines.map((l) => l.text)).toEqual(['Shuffle and Sort', 'Reducers receive all values for one key.']);
    expect(pages.flatMap((p) => p.lines.filter((l) => l.isHeading).map((l) => l.text))).toEqual([
      'Introduction to MapReduce',
      'Shuffle and Sort',
    ]);
  });
});

describe('text processing', () => {
  it('orders lines top to bottom and joins words on the same baseline', () => {
    const lines = itemsToLines([
      { str: 'second', x: 72, y: 600, width: 40, fontSize: 12 },
      { str: 'Hello', x: 72, y: 700, width: 30, fontSize: 12 },
      { str: 'world', x: 110, y: 700.2, width: 30, fontSize: 12 },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'second']);
  });

  it.each([
    ['Gradient Descent Basics', true],
    ['The history of the Internet', false],
    ['This is a normal sentence.', false],
    ['CHAPTER ONE', true],
    ['lowercase heading', false],
  ])('looksLikeTitle(%s) = %s', (text, expected) => {
    expect(looksLikeTitle(text)).toBe(expected);
  });

  it('marks lines with a clearly larger font as headings', () => {
    const [p] = markHeadings([
      { page: 1, lines: [{ text: 'big one here', fontSize: 24 }, ...Array.from({ length: 5 }, () => ({ text: 'plain body text of the page', fontSize: 12 }))] },
    ]);
    expect(p!.lines.map((l) => l.isHeading)).toEqual([true, false, false, false, false, false]);
  });
});
