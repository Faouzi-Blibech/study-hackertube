# Progress

## Done
- Task 1: HackerTube data in `data/raw/` (gitignored), dataset summarized.
- Step 1: Vite + TypeScript setup, license, README credit, CLAUDE.md, PLAN.md.
- Step 2: `scripts/prepare_data.py` -> `public/data/` (3,008 videos, float16 embeddings).
- Step 3: transcript fetch + 60-90 s segments + Actions workflow (8 videos done locally).
- Steps 4-5: pdf.js extraction, chunking, Transformers.js embeddings, two-step retrieval.
- Step 7: 3D card grid, liquid hover, in-place player, coverage notice ("catalog limit").
- UI wired to the core; end-to-end upload works (Big Data PDF -> 12 videos, limited coverage).
- 52 tests passing (`npm test`), build passing.

## Next
- Run the transcript job for all videos (Actions first; home PC if YouTube blocks it), so
  matches get real start times.
- Step 6: evaluate Laya against retrieval on a small labeled set.
- Step 8 galaxy, step 9 Chrome extension, step 10 testing with real course PDFs.
- GitHub Pages deploy workflow (needs a push; ask Faouzi first).

## Known issues / risks
- Coverage threshold 0.74 calibrated on 11 topics; retune with real PDFs in step 10.
- `level` is 71% "general": level fit needs the decision layer.
- YouTube blocks cloud IPs: the Actions transcript job may fail.
- Laya is near chance zero-shot and has no documented WebGPU path.
- Three.js chunk is 530 kB (lazy); thumbnails show grey boxes until loaded on slow networks.
- Escape does not close the player while focus is inside the YouTube iframe (close button works).
