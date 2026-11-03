// Shared data contracts between the data files, src/core and src/web.
// Changing a type here is a cross-module change: update every user.

/** One row of public/data/videos.json. Row i matches row i of video_emb.f16. */
export interface Video {
  vid: string; // 11-char YouTube id
  title: string;
  channel: string;
  summary: string;
  content_type: 'lecture' | 'course' | 'tutorial' | 'explainer' | 'talk';
  level: 'general' | 'intro' | 'intermediate' | 'advanced';
  primary_topic: string;
  tags: string[];
  score: number;
  categories: string[]; // taxonomy category ids, best first
  area: string | null; // taxonomy area id of the first category
}

/** One timed transcript segment of a video (public/data/segments/<vid>.json). */
export interface Segment {
  start: number; // seconds from video start
  end: number; // seconds
  text: string;
}

/** A chunk of text extracted from the uploaded PDF. */
export interface PdfChunk {
  id: number; // order in the document
  page: number; // 1-based page where the chunk starts
  heading: string | null; // nearest heading above the chunk, if detected
  text: string;
}

/** What the UI shows: a video, why it matched, and where to start playing. */
export interface Match {
  video: Video;
  score: number; // final relevance, 0..1, higher is better
  startSeconds: number; // 0 when no segment-level match exists yet
  segment: Segment | null;
  chunkIds: number[]; // which PDF chunks this match explains
  similarity?: number; // best absolute cosine between this video and any chunk (0..1)
}

/**
 * How well HackerTube's catalog covers the uploaded course. A low level means the source data
 * has few videos on these topics; it is not a failure of the app.
 */
export interface Coverage {
  level: 'good' | 'partial' | 'limited';
  coveredChunks: number;
  totalChunks: number;
  gaps: string[]; // up to 5 weakly covered topics (chunk headings or first words)
}

/** Decision 1: what course this is, from the taxonomy (16 areas, 150 categories). */
export interface CourseIdentity {
  area: { id: string; name: string; confidence: number }; // confidence 0..1
  categories: { id: string; name: string; confidence: number }[]; // up to 3, best first, inside the area
  method: 'embedding' | 'laya'; // which decider produced it
}

/** public/data/galaxy.json: 2D/3D layout of the catalog for the topic galaxy (step 8). */
export interface GalaxyData {
  categories: { id: string; name: string; area: string; x: number; y: number; z: number }[];
  videos: { i: number; x: number; y: number; z: number }[]; // i = row in videos.json
}
