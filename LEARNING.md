# StudyHackerTube: Learning Log

One section per task: what was built, the key concepts, the options considered, and why we chose this one.

---

## Task 1: Bring in the HackerTube data

**Date:** 2026-11-03

### What was built

- Copied the HackerTube export into `data/raw/` (7 files, about 50 MB).
- Added `data/raw/` to `.gitignore`, so git never tracks these files.
- Read `DATA.md` and measured the dataset to check the project plan against it.

### Key concepts

**Raw vs. derived data.** `data/raw/` holds the files exactly as downloaded, never edited by hand.
Everything the app uses later (filtered videos, browser-friendly embeddings) is *derived* by a script
that reads from `raw/`. If a script has a bug, you fix it and rerun it; the source stays clean.

**Why ignore raw data in git.** Git stores every version of every file forever. A 35 MB file
committed once stays in the repo history even after you delete it. Large, reproducible inputs belong
outside version control; the repo stores the *instructions* to get them (a README line or a
download script).

**JSONL.** "JSON Lines": one JSON object per line. You can read it line by line without loading the
whole file, and appending a record is just writing one more line.

**Joins by key.** The files link to each other through `vid` (the 11-character YouTube id), like
foreign keys in a database. `videos.jsonl` is the hub; `mentions`, `related` and the embeddings all
point to it.

**Embeddings.** `embeddings.npy` is a matrix of 6,454 rows by 384 numbers. Each row is one video's
meaning as a vector, made by the `bge-small-en-v1.5` model. Vectors are L2-normalized (length 1), so
the dot product of two rows is their cosine similarity: close to 1 means similar meaning. A query only
works if it is embedded with the *same* model, which is why the plan uses bge-small in the browser.

**Licensing (ODC-By 1.0).** Open data license that allows reuse and derived works as long as you credit
the source. YouTube's own metadata (descriptions, view counts, durations) is *not* in the export
because YouTube's API terms forbid redistributing it.

### Options considered

| Option | Trade-off |
|---|---|
| **Copy into `data/raw/`, gitignored** (chosen) | Repo stays small; each machine needs its own copy of the zip. |
| Commit the data to git | Simple, but bloats history with 50 MB forever, and redistributes data we should only use with credit. |
| Git LFS | Handles big files, but the free quota is small and it adds a tool for no real gain here. |
| Read straight from `Downloads/` | No copy, but the path is machine-specific and breaks on any other PC or in GitHub Actions. |

### Why this one

The rule given was "free to run, credit HackerTube, don't redistribute". Keeping raw data local and
out of git matches all three, and the copy keeps paths inside the repo stable for later scripts.

### Findings that affect the plan

- 3,017 videos pass the plan's filter (lecture, course, tutorial, explainer, talk; not news).
  Only 24 are tagged `course`.
- `level` is a weak signal: 71% of videos are labeled `general`. Decision 3 (level fit) cannot rely
  on it alone.
- Embeddings describe each video's *card* (title, summary, topics, HN comments), not its transcript.
  That suits Step A (find candidate videos); Step B needs our own segment embeddings.
- Embeddings are stored as float16. Browsers handle float32 more easily, so step 2 of the build
  converts them.
- HackerTube used the quantized ONNX build of bge-small. Transformers.js has its own ONNX build;
  vectors should be very close but should be checked for compatibility in build step 5.

### Decision: repo structure

Chose **one package with folders** (`src/core`, `src/web`, `src/extension`, `scripts/`,
`public/data/`) over **npm workspaces** (`packages/core`, `apps/web`, `apps/extension`).

- **Monorepo / workspaces:** several packages in one repo, each with its own `package.json`. The
  package manager links them so `apps/web` can `import` from `packages/core` like an installed
  library. That makes the boundary real: core cannot reach into web code by accident.
- **Why not now:** it costs extra config before anything works, and the only second consumer of
  `core` (the Chrome extension) arrives at build step 9. Until then the boundary is a convention:
  `src/core` must never import from `src/web`. Moving to workspaces later is about 30 minutes.

---

## Build step 1: Repo setup (Vite + TypeScript)

**Date:** 2026-11-03. From here on, choices are made autonomously and logged here.

### What was built

- `package.json` with scripts: `dev` (Vite server), `build` (`tsc --noEmit && vite build`),
  `typecheck`. Dependencies: `three`; dev: `vite` 8, `typescript` 7, `@types/three`, `@types/node`.
- `vite.config.ts`: app root is `src/web`, static files from `public/`, output to `dist/`,
  `base: '/study-hackertube/'`.
- `tsconfig.json` in strict mode. Placeholder page in `src/web/`.
- MIT `LICENSE`, README with HackerTube credit, `CLAUDE.md` (workflow rules), `PLAN.md`.
- Work happens on the `dev` branch; `main` stays as the published line.

### Key concepts

**Dev server vs. build.** `npm run dev` serves source files as native ES modules and swaps edited
modules in place (hot module replacement), so changes show instantly. `npm run build` bundles,
tree-shakes (drops unused code) and minifies into `dist/`, which is what GitHub Pages hosts.

**Vite does not type-check.** It strips TypeScript types with a fast transpiler and never reports
type errors. That is why `build` runs `tsc --noEmit` first: `tsc` checks types and writes nothing.

**`base` path.** GitHub Pages serves a project site at `/<repo-name>/`, not `/`. Vite rewrites asset
URLs with `base`, so `/assets/x.js` becomes `/study-hackertube/assets/x.js`. Without it, the deployed
page loads but every script 404s.

**`strict` TypeScript.** Turns on `strictNullChecks` and friends: a value that can be `null` (like
`document.querySelector`) must be checked before use. Catches the most common runtime crash.

**`verbatimModuleSyntax`.** Forces `import type { X }` for type-only imports, so the transpiler
knows exactly which imports to delete. Required for correctness when Vite transpiles file by file.

**`import.meta.dirname`.** The ES-module replacement for CommonJS `__dirname` (the folder of the
current file). Vite warned that `__dirname` will break under its future native config loader.

### Options considered

| Choice | Options | Picked | Why |
|---|---|---|---|
| UI framework | vanilla TS, React, Svelte | vanilla TS | The heavy parts (pdf.js, Transformers.js, Three.js) are framework-free; vanilla keeps bundles small and the extension can reuse code with no runtime. Revisit at step 7 if the UI gets messy. |
| Package manager | npm, pnpm | npm | Ships with Node; pnpm's advantages show mostly with workspaces, which we skipped. |
| Build tool | Vite, webpack, plain `tsc` | Vite | Near-instant dev server, zero-config TypeScript, first-class static output. |
| Branching | commit to `main`, `dev` branch | `dev` | `main` will drive GitHub Pages deploys; only tested work should reach it. |
