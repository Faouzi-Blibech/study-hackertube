// DOM rendering of the analysis result for the narrow side panel.
import type { AnalysisResult } from '../core';
import { hackerTubeUrl, thumbFallbackUrl, thumbUrl, youtubeUrl, formatTime } from '../web/format';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

function link(href: string, text: string, cls?: string): HTMLAnchorElement {
  const a = el('a', text, cls);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export function renderNotice(box: HTMLElement, result: AnalysisResult): void {
  box.replaceChildren();
  const c = result.coverage;
  box.hidden = c.level === 'good';
  if (c.level === 'good') return;
  const gaps = c.gaps.join(', ');
  if (c.level === 'limited') {
    box.append(el('h2', 'HackerTube has few videos on this course'));
    box.append(el('p', 'HackerTube only includes videos that Hacker News readers recommended again and again, so specialized course topics are thin.' +
      (gaps ? ` These parts have no close video: ${gaps}.` : '') +
      ' The videos below are the closest HackerTube has. This is a limit of the source catalog, not of StudyHackerTube.'));
  } else {
    box.append(el('h2', 'Some parts of this course are not covered'));
    box.append(el('p', (gaps ? `HackerTube has no close video for: ${gaps}. ` : '') +
      'Matches for those parts are only loosely related. HackerTube is a curated catalog of what Hacker News recommends, so some topics are missing.'));
  }
  box.append(el('p', `${c.coveredChunks} of ${c.totalChunks} sections have a close match`, 'hint'));
}

export function renderCourse(box: HTMLElement, result: AnalysisResult): void {
  box.replaceChildren();
  const course = result.course;
  box.hidden = !course;
  if (!course) return;
  box.append(el('h2', `Looks like: ${course.area.name}`));
  const cats = course.categories.map((c) => c.name).join(', ');
  if (cats) box.append(el('p', cats, 'hint'));
}

export function renderMatches(list: HTMLElement, result: AnalysisResult): void {
  list.replaceChildren();
  for (const m of result.matches) {
    const v = m.video;
    const card = el('li', undefined, 'card');
    const open = link(youtubeUrl(v.vid, m.startSeconds), '', 'open');
    const img = el('img');
    img.src = thumbUrl(v.vid);
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.src = thumbFallbackUrl(v.vid); }, { once: true });
    const body = el('div', undefined, 'body');
    body.append(el('div', v.title, 'title'));
    const meta = el('div', `${v.channel} - starts at `, 'meta');
    meta.append(el('span', formatTime(m.startSeconds), 'time'));
    body.append(meta);
    open.append(img, body);
    const more = el('div', undefined, 'more');
    more.append(link(hackerTubeUrl(v.vid), 'See it on HackerTube'));
    card.append(open, more);
    list.append(card);
  }
}
