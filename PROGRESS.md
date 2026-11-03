# Progress

## Done
- Task 1: HackerTube data copied to `data/raw/` (gitignored), dataset summarized.
- Step 1: Vite + TypeScript repo setup, license, README credit, CLAUDE.md, PLAN.md.
- Step 2: `scripts/prepare_data.py` -> `public/data/` (3,008 videos, float16 embeddings).
- Shared contracts in `src/core/types.ts`; deps for pdf.js, Transformers.js, vitest, Playwright.

## In progress (parallel workers, separate folders)
- Step 3: transcript pipeline (`scripts/`, `.github/workflows/transcripts.yml`, `public/data/segments/`).
- Steps 4-5: PDF extraction, chunking, embeddings, retrieval (`src/core/`).
- Step 7: 3D card grid, gooey hover, in-place player (`src/web/`).

## Next
- Wire `src/web` to `analyzePdf` from `src/core`.
- Step 6: Laya evaluation against retrieval (see risks).
- Step 8 galaxy, step 9 extension, step 10 testing.

## Known issues / risks
- `level` is 71% "general": level fit needs the decision layer.
- YouTube blocks cloud IPs: the Actions transcript job may fail; local run is the fallback.
- Laya is near chance zero-shot and has no documented WebGPU path; used only if it beats retrieval.
- Full transcripts are not published (creator content): only timestamps, short snippets, embeddings.
