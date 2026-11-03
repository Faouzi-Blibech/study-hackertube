import type { GalaxyData, Video } from '../../core/types';

export interface GalaxyBundle {
  galaxy: GalaxyData;
  videos: Video[];
  areaNames: Map<string, string>; // taxonomy area id -> display name
}

interface TaxonomyFile {
  areas: { id: string; name: string }[];
}

let pending: Promise<GalaxyBundle> | null = null;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Layout plus the video rows it indexes, fetched once per page load. */
export function loadGalaxy(): Promise<GalaxyBundle> {
  pending ??= Promise.all([getJson<GalaxyData>('galaxy.json'), getJson<Video[]>('videos.json'), getJson<TaxonomyFile>('taxonomy.json')])
    .then(([galaxy, videos, tax]) => ({ galaxy, videos, areaNames: new Map(tax.areas.map((a) => [a.id, a.name])) }))
    .catch((err: unknown) => {
      pending = null; // allow a retry after a network error
      throw err;
    });
  return pending;
}
