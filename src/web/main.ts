import type { CourseIdentity, Match, Video } from '../core/types';
import { hooks, setBusy, setCourse, setProgress, setStatus, showCoverage, showMatches } from './app';
import './styles.css';

export { hooks, setCourse, setStatus, showCoverage, showMatches };

let busy = false;
const isPdf = (file: File): boolean => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
const progress = (p: { stage: string; fraction: number; message: string }): void => {
  setProgress(p.stage, p.fraction);
  setStatus(p.stage === 'model'
    ? `${p.message}. First run downloads the model (~35 MB); later runs are instant.`
    : p.message);
};
const begin = (): boolean => {
  if (busy) return false;
  busy = true;
  setBusy(true);
  showCoverage(null);
  setCourse(null);
  setProgress('extract', 0);
  return true;
};
const finish = (): void => {
  busy = false;
  setBusy(false);
  setProgress(null);
};
/** Fake course for ?demo, so the course line and galaxy highlight can be tested. Ids exist in taxonomy.json. */
const DEMO_COURSE: CourseIdentity = {
  area: { id: 'math-theory', name: 'Mathematics & Theoretical CS', confidence: 0.86 },
  categories: [
    { id: 'pure-mathematics', name: 'Pure mathematics', confidence: 0.82 },
    { id: 'recreational-math', name: 'Recreational & visual math', confidence: 0.41 },
  ],
  method: 'embedding',
};
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

async function loadAreas(): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/taxonomy.json`);
  if (!res.ok) throw new Error(`taxonomy.json: HTTP ${res.status}`);
  const data = (await res.json()) as { areas: { id: string; name: string }[] };
  return data.areas;
}

async function analyze(file: File): Promise<void> {
  if (!isPdf(file)) {
    setStatus('Please choose a PDF file.', 'error');
    return;
  }
  if (!begin()) return;
  try {
    setStatus('Loading the analyzer');
    const { analyzePdf } = await import('../core/index'); // heavy (pdf.js, Transformers.js): load on demand
    const { chunks, matches, sections, coverage, course } = await analyzePdf(file, progress);
    if (matches.length === 0) {
      setStatus(chunks.length === 0 ? 'No readable text found. Is this a scanned PDF?' : 'No videos found.', 'error');
      return;
    }
    showCoverage(coverage);
    setCourse(course ?? null);
    showMatches(matches, `Videos for ${file.name}`, { sections });
    setStatus(`${matches.length} videos for ${sections.length} chapters. Your PDF never left this browser.`);
  } catch (err) {
    setStatus(`Could not analyze the PDF: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    finish();
  }
}

async function search(query: string): Promise<void> {
  const topic = query.trim();
  if (!topic) {
    setStatus('Enter a topic to search.', 'error');
    return;
  }
  if (!begin()) return;
  try {
    setStatus('Loading search');
    const { searchText } = await import('../core/index');
    const { matches, coverage } = await searchText(topic, progress);
    showCoverage(coverage);
    showMatches(matches, `Videos for ${topic}`);
    setStatus(`${matches.length} videos for "${topic}".`);
  } catch (err) {
    setStatus(`Could not search: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    finish();
  }
}

function wireUpload(): void {
  hooks.onPdfSelected = (file) => void analyze(file);
  const input = document.querySelector<HTMLInputElement>('#pdf-input');
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) hooks.onPdfSelected(file);
    input.value = ''; // allow picking the same file again
  });
}

function wireSearchAndDrop(): void {
  const form = document.querySelector<HTMLFormElement>('#topic-form');
  const input = document.querySelector<HTMLInputElement>('#topic-input');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void search(input?.value ?? '');
  });
  const overlay = document.querySelector<HTMLElement>('#drop-overlay');
  let depth = 0;
  document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    depth++;
    if (overlay) overlay.hidden = false;
  });
  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  document.addEventListener('dragleave', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0 && overlay) overlay.hidden = true;
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    if (overlay) overlay.hidden = true;
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    if (!isPdf(file)) {
      setStatus('Only PDF files can be dropped here.', 'error');
      return;
    }
    hooks.onPdfSelected(file);
  });
}

async function start(): Promise<void> {
  wireUpload();
  wireSearchAndDrop();
  const app = document.querySelector<HTMLElement>('#app');
  try {
    const [videos, areas] = await Promise.all([loadVideos(), loadAreas()]);
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) {
      const limited = params.get('demo') === 'limited';
      showCoverage(
        limited
          ? { level: 'limited', coveredChunks: 3, totalChunks: 14, gaps: ['MapReduce', 'HDFS replication', 'YARN scheduling'] }
          : null,
      );
      setCourse(DEMO_COURSE);
      showMatches(asMatches(videos.slice(0, 12), DEMO_STARTS, limited ? 4 : Infinity), 'Demo results');
      setStatus('Demo mode: sample matches with start times.');
    } else {
      const sorted = [...videos].sort((a, b) => b.score - a.score);
      showMatches(asMatches(sorted), 'Browse videos', { catalog: true, areas });
    }
  } catch (err) {
    setStatus(`Could not load videos: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
  if (app) app.dataset.ready = 'true';
}

void start();
