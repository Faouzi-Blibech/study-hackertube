import type { Coverage, CourseIdentity, Match, SectionMatches } from '../core/types';
import { buildCard, buildGrid } from './cards';
import { mountGalaxy } from './galaxy-mount';
import type { GalaxyView } from './galaxy/galaxy-view';
import type { GlGrid } from './grid/gl-grid';
import { openPlayer } from './player';
import { buildCourseLine, buildViewToggle, type View } from './views';
import { webglAvailable } from './webgl';

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

export interface Area { id: string; name: string }
let current: { matches: Match[]; title: string; catalog: boolean; sections: SectionMatches[]; areas: Area[] } | null = null;
let selectedArea: string | null = null;
let course: CourseIdentity | null = null;
let view: View = 'grid';
let viewHost: HTMLElement | null = null;
let gl: GlGrid | null = null;
let galaxy: GalaxyView | null = null;
let renderToken = 0;
let moreObserver: IntersectionObserver | null = null;

export function setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
  const s = document.querySelector<HTMLElement>('#status');
  if (!s) return;
  s.textContent = text;
  s.dataset.kind = kind;
}

export function setBusy(busy: boolean): void {
  document.querySelector('#upload-label')?.setAttribute('aria-busy', String(busy));
  const search = document.querySelector<HTMLButtonElement>('#search-button');
  if (search) search.disabled = busy;
}

export function setProgress(stage: string | null, fraction = 0): void {
  const bar = document.querySelector<HTMLProgressElement>('#progress-bar');
  if (!bar) return;
  bar.hidden = !stage || stage === 'done';
  const stages = ['extract', 'chunk', 'model', 'embed', 'retrieve'];
  const index = stages.indexOf(stage ?? '');
  bar.value = index < 0 ? 0 : Math.min(100, ((index + Math.max(0, Math.min(1, fraction))) / stages.length) * 100);
}

function teardownGl(): void {
  gl?.destroy();
  gl = null;
}

function teardownViews(): void {
  moreObserver?.disconnect();
  moreObserver = null;
  teardownGl();
  galaxy?.destroy();
  galaxy = null;
}

/** Set (or clear) the identified course; shown above the next results and highlighted in the galaxy. */
export function setCourse(c: CourseIdentity | null): void {
  course = c;
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

export interface ShowOptions {
  /** True for the home page: the galaxy then shows the whole catalog instead of lighting up matches. */
  catalog?: boolean;
  sections?: SectionMatches[];
  areas?: Area[];
}

const galaxyAllowed = (): boolean => !reducedQuery.matches && webglAvailable();

/** Render a list of matches as a grid or galaxy (replaces whatever is shown). */
export function showMatches(matches: Match[], title = 'Matches for your course', opts: ShowOptions = {}): void {
  current = { matches, title, catalog: opts.catalog ?? false, sections: opts.sections ?? [], areas: opts.areas ?? [] };
  selectedArea = null;
  view = 'grid';
  ++renderToken;
  teardownViews();
  const root = results();
  root.replaceChildren();
  const line = buildCourseLine(opts.catalog ? null : course);
  if (line) root.append(line);

  const head = document.createElement('div');
  head.className = 'results-head';
  const h2 = document.createElement('h2');
  h2.id = 'results-title';
  h2.textContent = title;
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = `${matches.length} video${matches.length === 1 ? '' : 's'}`;
  head.append(h2, count);
  if (matches.length > 0 && galaxyAllowed()) {
    head.append(buildViewToggle(view, (v) => {
      view = v;
      renderView();
    }));
  } else {
    view = 'grid';
  }
  root.append(head);
  viewHost = document.createElement('div');
  viewHost.className = 'view-host';
  root.append(viewHost);
  renderView();
}

function renderView(): void {
  if (!current || !viewHost) return;
  const { matches, catalog, sections, areas } = current;
  const host = viewHost;
  const token = ++renderToken;
  teardownViews();
  host.replaceChildren();
  document.body.dataset.mode = 'html';
  if (matches.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No matching videos found.';
    host.append(p);
    return;
  }
  if (view === 'galaxy' && galaxyAllowed()) {
    void mountGalaxy({
      host, matches, catalog, course,
      isCurrent: () => token === renderToken,
      onFail: (message) => {
        view = 'grid';
        setStatus(message, 'error');
        document.querySelector<HTMLButtonElement>('.view-toggle button[data-view="grid"]')?.click();
      },
    }).then((v) => {
      if (v) galaxy = v;
    });
    return;
  }
  if (catalog) {
    const filters = document.createElement('div');
    filters.className = 'area-filters';
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter by topic area');
    for (const area of [{ id: '', name: 'All' }, ...areas]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'area-filter';
      button.textContent = area.name;
      button.setAttribute('aria-pressed', String((selectedArea ?? '') === area.id));
      button.addEventListener('click', () => {
        selectedArea = area.id || null;
        renderView();
      });
      filters.append(button);
    }
    host.append(filters);
  }
  if (sections.length > 0) {
    const byChapter = document.createElement('section');
    byChapter.className = 'chapters';
    const heading = document.createElement('h3');
    heading.textContent = 'By chapter';
    byChapter.append(heading);
    sections.forEach((section) => {
      const block = document.createElement('section');
      block.className = 'chapter';
      const title = document.createElement('h4');
      title.textContent = section.title;
      const row = buildGrid(section.matches);
      row.classList.add('chapter-grid');
      row.addEventListener('click', (e) => onGridClick(e, section.matches));
      block.append(title, row);
      byChapter.append(block);
    });
    host.append(byChapter);
    const allTitle = document.createElement('h3');
    allTitle.className = 'all-videos-title';
    allTitle.textContent = 'All videos';
    host.append(allTitle);
  }
  const shown = selectedArea ? matches.filter((match) => match.video.area === selectedArea) : matches;
  const count = document.querySelector<HTMLElement>('.results-head .count');
  if (count) count.textContent = `${shown.length} video${shown.length === 1 ? '' : 's'}`;
  const initial = catalog ? 40 : 24;
  const grid = buildGrid(shown.slice(0, initial));
  host.append(grid);
  grid.addEventListener('click', (e) => onGridClick(e, shown));
  if (shown.length > initial) {
    let visible = initial;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'show-more';
    more.textContent = 'Show more';
    const loadMore = (): void => {
      const next = Math.min(visible + (catalog ? 40 : 16), shown.length);
      const cells = document.createDocumentFragment();
      for (let i = visible; i < next; i++) cells.append(buildCard(shown[i]!, i));
      grid.append(cells);
      visible = next;
      if (visible === shown.length) {
        moreObserver?.disconnect();
        moreObserver = null;
        more.remove();
      }
    };
    more.addEventListener('click', loadMore);
    host.append(more);
    if (catalog && 'IntersectionObserver' in window) {
      moreObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      }, { rootMargin: '300px 0px' });
      moreObserver.observe(more);
    }
  }
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
  if (current) showMatches(current.matches, current.title, {
    catalog: current.catalog, sections: current.sections, areas: current.areas,
  });
});
