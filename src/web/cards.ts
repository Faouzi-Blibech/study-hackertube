import type { Match } from '../core/types';
import { formatTime, isLoose, thumbFallbackUrl, thumbUrl, youtubeUrl } from './format';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One grid cell: a real link (works without JS) whose click is intercepted by the app. */
export function buildCard(match: Match, index: number): HTMLLIElement {
  const { video, startSeconds } = match;
  const li = el('li', 'card-item');
  const a = el('a', 'card');
  a.href = youtubeUrl(video.vid, startSeconds);
  a.dataset.index = String(index);
  a.setAttribute('aria-haspopup', 'dialog');
  const start = startSeconds > 0 ? `, starts at ${formatTime(startSeconds)}` : '';
  const loose = isLoose(match) ? ', loose match' : '';
  a.setAttribute('aria-label', `${video.title}, ${video.channel}${start}${loose}`);

  const thumb = el('span', 'thumb');
  const img = document.createElement('img');
  // CORS-enabled so the same decoded image can be uploaded as a WebGL texture.
  img.crossOrigin = 'anonymous';
  img.alt = '';
  img.decoding = 'async';
  img.loading = index < 8 ? 'eager' : 'lazy';
  img.width = 480;
  img.height = 360;
  let triedFallback = false;
  img.addEventListener('error', () => {
    if (triedFallback) return;
    triedFallback = true;
    img.src = thumbFallbackUrl(video.vid);
  });
  img.src = thumbUrl(video.vid);
  thumb.append(img);
  if (startSeconds > 0) thumb.append(el('span', 'chip', `from ${formatTime(startSeconds)}`));

  const meta = el('span', 'meta');
  meta.append(el('span', 'title', video.title), el('span', 'channel', video.channel));
  if (isLoose(match)) meta.append(el('span', 'loose', 'Loose match'));
  a.append(thumb, meta);
  li.append(a);
  return li;
}

export function buildGrid(matches: Match[]): HTMLUListElement {
  const ul = el('ul', 'grid');
  matches.forEach((m, i) => ul.append(buildCard(m, i)));
  return ul;
}
