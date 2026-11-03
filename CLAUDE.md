# StudyHackerTube

Students upload a course PDF; the app finds the HackerTube video segments (with timestamps) that
explain each chapter. Static site on GitHub Pages; all heavy work runs in the browser or in GitHub
Actions. The full plan and build order are in `PLAN.md`. `PROGRESS.md` and `LEARNING.md` are
Faouzi's personal notes: gitignored, local only, never commit them.

## Hard rules

- Free to run: no paid servers, no paid APIs, no API keys committed.
- Privacy: PDF text is processed in the browser and never uploaded.
- Credit HackerTube (ODC-By 1.0) in the README and the UI footer. Never redistribute YouTube API
  metadata (descriptions, view counts, durations).
- `data/raw/` is gitignored and read-only. Scripts read from it and write derived files to
  `public/data/`.
- Commits are authored by Faouzi only. No `Co-Authored-By` or any AI attribution line, ever.
- No emojis in code, docs or commit messages.

## Layout

```
data/raw/            HackerTube export (gitignored, never edited)
scripts/             Python data prep, run with `python -I scripts/<name>.py`
public/data/         derived static files the site fetches at runtime
src/core/            PDF, embeddings, retrieval, decisions (no DOM, no imports from src/web)
src/web/             GitHub Pages app (Vite root); Three.js UI
src/extension/       Chrome extension wrapper (build step 9)
.github/workflows/   transcript job, Pages deploy
```

## Commands

- `npm run dev`: local server. `npm run build`: type-check then build to `dist/`.
- `npm run typecheck`: `tsc --noEmit` only.
- Python scripts use only the standard library plus numpy unless a step says otherwise.

## Stack decisions (reasons in LEARNING.md)

- Vite + vanilla TypeScript (strict), npm, Three.js. No UI framework.
- Embeddings: `BAAI/bge-small-en-v1.5` via Transformers.js, no instruction prefix, L2-normalized,
  to match HackerTube's `embeddings.npy`.
- Video playback: `https://www.youtube-nocookie.com/embed/<vid>?start=<seconds>`, plus "Open on
  YouTube" (`https://www.youtube.com/watch?v=<vid>&t=<seconds>s`) and "See it on HackerTube"
  (`https://hackertube.org/watch/<vid>`).
- UI: HackerTube's clean look first; 3D is an enhancement, and the page must still work with
  WebGL off or `prefers-reduced-motion`.

## Workflow

1. Follow the build order in `PLAN.md`, one step at a time; update `PROGRESS.md` after each.
2. After each step, add a section to `LEARNING.md`: what was built, key concepts, options
   considered, why this one. Written for Faouzi to study later.
3. Make choices autonomously and log them in `LEARNING.md`; ask Faouzi only when truly blocked.
4. Verify before calling a step done: show the command and its output.
5. Commit at the end of each step on the `dev` branch with a plain message. Never push or merge
   unless asked.

## Delegation

The main session orchestrates and reviews. Workers get a self-contained brief: goal, exact files,
what not to touch, the "done" command, and a 15-line report. Workers do not see this file, so
copy the hard rules they need into the brief. Parallel workers must own separate folders.
