import type { Match } from '../core/types';
import { embedUrl, formatTime, isLoose, hackerTubeUrl, thumbUrl, youtubeUrl } from './format';

export interface PlayerHooks {
  onOpen(): void;
  onClose(): void;
}

let active: { close(): void } | null = null;

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function link(text: string, href: string, className: string): HTMLAnchorElement {
  const a = node('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

/** Open the in-place player for a match. `origin` is the card link to animate from and return focus to. */
export function openPlayer(match: Match, origin: HTMLElement, hooks: PlayerHooks): void {
  active?.close();
  const { video, startSeconds } = match;
  const start = Math.floor(startSeconds);

  const scrim = node('div', 'player-scrim');
  const panel = node('div', 'player');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'player-title');

  const close = node('button', 'player-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close player');

  const frame = node('div', 'player-frame');
  frame.tabIndex = -1;
  frame.setAttribute('aria-label', 'Video player');
  const poster = document.createElement('img');
  poster.alt = '';
  poster.src = origin.querySelector('img')?.currentSrc || thumbUrl(video.vid);
  frame.append(poster);

  const body = node('div', 'player-body');
  const h2 = node('h2', '', video.title);
  h2.id = 'player-title';
  body.append(h2, node('span', 'channel', video.channel));
  if (start > 0) body.append(node('p', 'player-start', `Starts at ${formatTime(start)}`));
  if (isLoose(match)) body.append(node('p', 'loose', 'Loose match: related to this part of your course, not an exact fit.'));
  body.append(node('p', 'summary', video.summary));
  const actions = node('div', 'actions');
  actions.append(
    link('Open on YouTube', youtubeUrl(video.vid, start), 'btn primary'),
    link('See it on HackerTube', hackerTubeUrl(video.vid), 'btn'),
  );
  body.append(actions);
  panel.append(close, frame, body);
  scrim.append(panel);

  let closed = false;
  const mountIframe = (): void => {
    if (closed || frame.querySelector('iframe')) return;
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl(video.vid, start);
    iframe.title = `Video player: ${video.title}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.append(iframe);
  };

  const finish = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    document.body.classList.remove('player-open');
    active = null;
    if (origin.isConnected) origin.focus({ preventScroll: true });
    hooks.onClose();
  };

  const closePlayer = (): void => {
    if (closed) return;
    if (reduced()) return finish();
    scrim.animate({ opacity: [1, 0] }, { duration: 160, easing: 'ease-out' }).finished.then(finish, finish);
  };

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePlayer();
    } else if (e.key === 'Tab') {
      const items = [...panel.querySelectorAll<HTMLElement>('button, a[href], iframe')];
      const first = items[0];
      const lastItem = items[items.length - 1];
      if (!first || !lastItem) return;
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || !panel.contains(cur))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && cur === lastItem) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  close.addEventListener('click', closePlayer);
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) closePlayer();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.classList.add('player-open');
  document.body.append(scrim);
  hooks.onOpen();
  frame.focus({ preventScroll: true });
  active = { close: closePlayer };

  const thumb = origin.querySelector<HTMLElement>('.thumb');
  if (reduced() || !thumb) return mountIframe();
  // Expand: a ghost of the thumbnail flies from the card to the player frame, then the video loads.
  const from = thumb.getBoundingClientRect();
  const to = frame.getBoundingClientRect();
  const ghost = node('div', 'ghost');
  ghost.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;` +
    `background-image:url("${poster.src}");border-radius:12px;transform-origin:0 0;`;
  document.body.append(ghost);
  panel.style.opacity = '0';
  scrim.animate({ opacity: [0, 1] }, { duration: 200, easing: 'ease-out' });
  const sx = to.width / from.width;
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const fly = ghost.animate(
    [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${sx})`, borderRadius: '6px' }],
    { duration: 340, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  );
  fly.finished.then(() => {
    panel.style.opacity = '';
    panel.animate({ opacity: [0, 1] }, { duration: 120 });
    ghost.remove();
    mountIframe();
  }, () => ghost.remove());
}
