import type { CourseIdentity, Match } from '../core/types';
import type { GalaxyView } from './galaxy/galaxy-view';

export interface GalaxyMount {
  host: HTMLElement;
  matches: Match[];
  /** True on the home page: show the whole catalog, light nothing up. */
  catalog: boolean;
  course: CourseIdentity | null;
  /** Ask the caller whether this mount is still the current one (the user may have switched views). */
  isCurrent(): boolean;
  /** Unrecoverable: the caller should show the grid again. */
  onFail(message: string): void;
}

/** Lazy-load the Three.js galaxy chunk and build it into `m.host`. Returns null when it failed or went stale. */
export async function mountGalaxy(m: GalaxyMount): Promise<GalaxyView | null> {
  const box = document.createElement('div');
  box.className = 'galaxy';
  box.setAttribute('aria-busy', 'true');
  const note = document.createElement('p');
  note.className = 'galaxy-note';
  note.textContent = 'Loading the galaxy';
  m.host.append(box, note);
  try {
    const mod = await import('./galaxy/galaxy-view');
    const view = await mod.createGalaxy(box, {
      matches: m.catalog ? null : m.matches,
      course: m.catalog ? undefined : (m.course ?? undefined),
      onLost: () => m.onFail('The 3D view lost its graphics context. Showing the grid instead.'),
    });
    if (!m.isCurrent()) {
      view.destroy();
      return null;
    }
    box.removeAttribute('aria-busy');
    note.textContent = m.catalog
      ? 'Every dot is a video, colored by topic area. Drag to turn, scroll to zoom, click a dot to watch.'
      : 'Glowing dots are your matches; the rest of the catalog is dimmed. Drag to turn, scroll to zoom, click a dot to watch.';
    return view;
  } catch (err) {
    if (m.isCurrent()) m.onFail(`The 3D galaxy could not start: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
