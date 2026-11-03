import type { Match, Video } from '../core/types';
import { hooks, setStatus, showCoverage, showMatches } from './app';
import './styles.css';

export { hooks, setStatus, showCoverage, showMatches };

const FEATURED_COUNT = 40;
const DEMO_STARTS = [754, 95, 3720, 312, 1830, 48, 2210, 600, 15, 4105, 905, 1260];

function asMatches(videos: Video[], starts?: number[], looseFrom = Infinity): Match[] {
  const top = Math.max(...videos.map((v) => v.score), 1);
  return videos.map((video, i) => ({
    video,
    score: video.score / top,
    startSeconds: starts ? (starts[i % starts.length] ?? 0) : 0,
    segment: null,
    chunkIds: [],
    ...(i >= looseFrom ? { similarity: 0.7 } : {}),
  }));
}

async function loadVideos(): Promise<Video[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/videos.json`);
  if (!res.ok) throw new Error(`videos.json: HTTP ${res.status}`);
  return (await res.json()) as Video[];
}

function wireUpload(): void {
  const input = document.querySelector<HTMLInputElement>('#pdf-input');
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) hooks.onPdfSelected(file);
    input.value = ''; // allow picking the same file again
  });
}

async function start(): Promise<void> {
  wireUpload();
  const app = document.querySelector<HTMLElement>('#app');
  try {
    const videos = await loadVideos();
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) {
      const limited = params.get('demo') === 'limited';
      showCoverage(
        limited
          ? { level: 'limited', coveredChunks: 3, totalChunks: 14, gaps: ['MapReduce', 'HDFS replication', 'YARN scheduling'] }
          : null,
      );
      showMatches(asMatches(videos.slice(0, 12), DEMO_STARTS, limited ? 4 : Infinity), 'Demo results');
      setStatus('Demo mode: sample matches with start times.');
    } else {
      showMatches(asMatches(videos.slice(0, FEATURED_COUNT)), 'Featured');
    }
  } catch (err) {
    setStatus(`Could not load videos: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
  if (app) app.dataset.ready = 'true';
}

void start();
