import type { Coverage, Match } from '../core/types';
import { buildGrid } from './cards';
import type { GlGrid } from './grid/gl-grid';
import { openPlayer } from './player';

/** Slot for the PDF pipeline; main.ts replaces `hooks.onPdfSelected` once the core is wired. */
export const hooks = {
  onPdfSelected(_file: File): void {
    setStatus('PDF analysis is not connected yet.', 'error');
  },
};

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const results = (): HTMLElement => {
  const n = document.querySelector<HTMLElement>('#results');
  if (!n) throw new Error('#results missing');
  return n;
};

let current: { matches: Match[]; title: string } | null = null;
let gl: GlGrid | null = null;
let renderToken = 0;

export function setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
  const s = document.querySelector<HTMLElement>('#status');
  if (!s) return;
  s.textContent = text;
  s.dataset.kind = kind;
}

export function setBusy(busy: boolean): void {
  document.querySelector('#upload-label')?.setAttribute('aria-busy', String(busy));
}

function teardownGl(): void {
  gl?.destroy();
  gl = null;
}

/** Calm notice explaining that thin results are a catalog limit. Null or 'good' hides it. */
export function showCoverage(c: Coverage | null): void {
  const box = document.querySelector<HTMLElement>('#coverage');
  if (!box) return;
  box.replaceChildren();
  if (!c || c.level === 'good') {
    box.hidden = true;
    return;
  }
  const gaps = c.gaps.join(', ');
  const add = (tag: string, text: string, cls?: string): HTMLElement => {
    const n = document.createElement(tag);
    n.textContent = text;
    if (cls) n.className = cls;
    box.append(n);
    return n;
  };
  if (c.level === 'limited') {
    add('h2', 'HackerTube has few videos on this course');
    add('p', 'HackerTube only includes videos that Hacker News readers recommended again and again, so specialized course topics are thin.' +
      (gaps ? ` These parts have no close video: ${gaps}.` : '') +
      ' The videos below are the closest HackerTube has. This is a limit of the source catalog, not of StudyHackerTube.');
  } else {
    add('h2', 'Some parts of this course are not covered');
    add('p', (gaps ? `HackerTube has no close video for: ${gaps}. ` : '') +
      'Matches for those parts are only loosely related. HackerTube is a curated catalog of what Hacker News recommends, so some topics are missing.');
  }
  add('p', `${c.coveredChunks} of ${c.totalChunks} sections have a close match`, 'covered');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Why?';
  const why = document.createElement('p');
  why.append('HackerTube is built from YouTube links that were recommended on Hacker News. It covers programming, computer science, math and science talks well, and niche course topics (for example industrial automation or specific enterprise tools) much less. See ');
  const a = document.createElement('a');
  a.href = 'https://hackertube.org';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'hackertube.org';
  why.append(a, '.');
  details.append(summary, why);
  box.append(details);
  box.hidden = false;
}

/** Render a list of matches as the grid (replaces whatever is shown). */
export function showMatches(matches: Match[], title = 'Matches for your course'): void {
  current = { matches, title };
  const token = ++renderToken;
  teardownGl();
  const root = results();
  root.replaceChildren();

  const head = document.createElement('div');
  head.className = 'results-head';
  const h2 = document.createElement('h2');
  h2.id = 'results-title';
  h2.textContent = title;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = `${matches.length} video${matches.length === 1 ? '' : 's'}`;
  head.append(h2, count);
  root.append(head);

  if (matches.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No matching videos found.';
    root.append(p);
    document.body.dataset.mode = 'html';
    return;
  }
  const grid = buildGrid(matches);
  root.append(grid);
  grid.addEventListener('click', (e) => onGridClick(e, matches));
  document.body.dataset.mode = 'html';
  void enhance(grid, token);
}

async function enhance(grid: HTMLElement, token: number): Promise<void> {
  if (reducedQuery.matches) return;
  try {
    const mod = await import('./grid/gl-grid');
    if (token !== renderToken || !mod.webglAvailable()) return;
    document.body.dataset.mode = 'gl';
    gl = mod.createGlGrid(grid, () => {
      teardownGl();
      document.body.dataset.mode = 'html';
    });
  } catch {
    document.body.dataset.mode = 'html';
    teardownGl();
  }
}

function onGridClick(e: MouseEvent, matches: Match[]): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const card = (e.target as Element).closest<HTMLAnchorElement>('a.card');
  const match = card ? matches[Number(card.dataset['index'])] : undefined;
  if (!card || !match) return;
  e.preventDefault();
  openPlayer(match, card, { onOpen: () => gl?.setSuspended(true), onClose: () => gl?.setSuspended(false) });
}

// Switching reduced-motion at runtime swaps between the 3D and plain grids.
reducedQuery.addEventListener('change', () => {
  if (current) showMatches(current.matches, current.title);
});
