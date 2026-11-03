# StudyHackerTube: Project Plan

A student-focused extension of Karpathy's HackerTube. Students upload course PDFs; the system
identifies the course and chapters, then points them to the exact HackerTube video segments (with
timestamps) that explain each part.

## Principles

- Free to run: no paid servers, no paid APIs.
- Privacy: PDFs are processed in the browser where possible.
- Learn-first: each layer is explained in LEARNING.md.
- Credit HackerTube (ODC-By 1.0). Do not redistribute YouTube metadata.

## Architecture

### 1. Data layer
- Source: HackerTube export (videos.jsonl, mentions.jsonl, taxonomy.json, related.jsonl,
  embeddings.npy).
- Filter to educational, non-news videos (lecture, course, tutorial, explainer, talk).
- Transcripts: fetched and chunked into timed segments (about 60-90 seconds) by a GitHub Actions
  job, not on the local PC.
- Output: static files (segment texts, timestamps, segment embeddings) published with the site.

### 2. Retrieval layer (embeddings)
- Model: BAAI/bge-small-en-v1.5, same as HackerTube, so vectors are compatible.
- Runs in the browser with Transformers.js.
- PDF text is extracted in the browser (pdf.js) and split into chunks under 512 tokens.
- Step A: chunk vs video embeddings gives the top candidate videos.
- Step B: chunk vs segment embeddings inside those videos gives candidate segments.

### 3. Decision layer (Laya)
- Model: Laya (ConvAI Innovations, Apache 2.0); laya-multilingual for French slides.
- Decision 1, course identification (choice): first among 16 areas, then among that area's
  topics. Votes are aggregated across chunks.
- Decision 2, segment relevance (score): for each pair of slide chunk and transcript segment.
- Decision 3, level fit (yes/no): is the segment suitable for this student's level?
- Hosting: WebGPU in the browser first; fallback is a free Hugging Face Space with batched calls.
- Optional: a Jev-compatible endpoint via laya-serve.

### 4. Front end
- Web app on GitHub Pages; Chrome extension sharing the same core code.
- Home page: interactive 3D video-card grid (inspired by Codrops "Building an Interactive Image
  Grid with Three.js", 2025).
- Opening a video: hover and expand effect (inspired by Codrops "Making Gooey Image Hover Effects
  with Three.js", 2019).
- Keep HackerTube's clean look; 3D is an enhancement, not a gimmick.
- 3D view: a galaxy of topics where the uploaded course lights up its matched videos.
- Playback in place: youtube-nocookie.com embed starting at the chosen timestamp. Below it:
  "Open on YouTube" (with timestamp) and "See it on HackerTube" (hackertube.org/watch/<vid>).
  The site decides what to watch; it does not replace YouTube or HackerTube.

## Build order

1. Repo setup: Vite + TypeScript, MIT license, credit HackerTube data.
2. Data prep script: filter videos, convert embeddings to a browser-friendly format.
3. Transcript pipeline in GitHub Actions.
4. Browser PDF extraction and chunking.
5. Browser embeddings and retrieval.
6. Laya decision service (WebGPU test, then HF Space fallback).
7. Results UI with timestamps (3D card grid, hover/expand, in-place player).
8. 3D topic galaxy.
9. Chrome extension wrapper.
10. Testing at the end: Big Data course (Hadoop, MapReduce), then PLC/VHDL as a stress test.
