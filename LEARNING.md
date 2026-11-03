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

---

## Build step 2: Data prep script

**Date:** 2026-11-03

### What was built

`scripts/prepare_data.py` reads `data/raw/` and writes `public/data/`:
- `videos.json` (1.8 MB): 3,008 educational videos, best score first, compact fields only.
- `video_emb.f16` (2.3 MB): their embeddings as raw float16 bytes, row `i` = `videos.json[i]`.
- `taxonomy.json`, `manifest.json` (count, dims, dtype, model, credit).

Run: `python -I scripts/prepare_data.py` (prints counts and file sizes).

### Key concepts

**Filtering.** Keep `content_type` in {lecture, course, tutorial, explainer, talk} and drop
`shelf_life == "news"`. 3,017 pass; 9 were re-uploads of the same talk.

**Deduplication by normalized title.** Lowercase, replace everything that is not a letter or digit
with a space. "Simple Made Easy!" and "simple made easy" become the same key; the copy with the
higher score wins.

**Index alignment.** The embedding matrix has no ids inside it: row `i` means "video number `i`".
When we filter videos we must pick the matching rows in the same order, or every search result
points at the wrong video. The script asserts this alignment and that rows are unit length.

**float16 and raw binary.** A float16 number is 2 bytes (float32 is 4). For similarity search
float16's ~3 significant digits are plenty. Raw bytes (no header) are trivial to load in the
browser: `fetch` -> `ArrayBuffer` -> typed array. JSON would be ~4x bigger and slow to parse.
Little-endian (`<f2`) is fixed explicitly because every browser CPU is little-endian.

**Derived data in git.** Unlike `data/raw/`, `public/data/` is committed: GitHub Pages can only
serve files that are in the repo, and it is small. ODC-By allows sharing derived data with credit,
which the manifest and README carry. No YouTube API data is included.

### Options considered

| Choice | Options | Picked | Why |
|---|---|---|---|
| Embedding format | JSON arrays, float32 binary, float16 binary, int8 quantized | float16 binary | Half the size of float32 with no measurable loss; int8 needs a scale per row and saves only 1 MB more. |
| Data format | JSONL, JSON array, SQLite (sql.js) | JSON array | One `fetch` + `JSON.parse`; 1.8 MB is small enough. SQLite adds a 1 MB WASM runtime for nothing. |
| Keep cited-only videos (no recommenders) | drop, keep | keep | A cited lecture can still be the best explanation; `score` already ranks it low. |

### Risk findings logged during this step

- **Transcripts (step 3):** YouTube blocks most cloud-provider IPs, which likely includes GitHub
  Actions runners (Azure). The documented fix is paid proxies, which breaks "free to run". Plan:
  write the job so it runs in Actions *and* locally; if Actions is blocked, run it once from a home
  connection and commit the output. Only transcripts change rarely, so a one-off local run is fine.
- **Laya (step 6):** the model card reports the base checkpoints are near chance zero-shot on its
  own typed-decision benchmark (0.36) and need fine-tuning (0.77). It has a custom decision head and
  no documented Transformers.js/WebGPU path. Plan: retrieval similarity is the primary signal; Laya
  is added as a re-ranker only if it beats retrieval on a small labeled set from the Big Data course.

---

## Build step 3: Transcript pipeline

**Date:** 2026-11-03

### What was built

- `scripts/fetch_transcripts.py`: downloads English transcripts with `youtube-transcript-api`
  1.2.4 into the gitignored `data/transcripts/` cache. Resumable (skips cached videos), logs failures
  in `_status.json`, stops after 3 consecutive IP blocks (exit code 2).
- `scripts/build_segments.py`: merges caption lines into 60-90 s segments, embeds each with
  `fastembed` bge-small (the exact build HackerTube used), writes `public/data/segments/<vid>.json`
  (start, end, 160-char snippet) + `<vid>.f16` (embeddings) + `index.json`.
- `.github/workflows/transcripts.yml`: manual workflow (`limit` input) that runs both scripts and
  commits new segments.
- Verified locally on 8 videos, 408 segments; 99% are 60-90 s, all rows unit length.

Run locally: `.venv/Scripts/python scripts/fetch_transcripts.py --limit 200`, then
`.venv/Scripts/python scripts/build_segments.py`.

### Key concepts

**Caption snippets vs. segments.** YouTube captions come as short snippets (2-5 s each, with
`start` and `duration`). One snippet is too short to mean anything; a whole video is too long to
point at a moment. Grouping snippets into ~75 s windows gives units that hold one idea and still
give a precise start time. Cuts only happen between snippets, so no sentence is split mid-word.

**Why segment embeddings live in separate per-video files.** All segments for 3,008 videos would be
~140 MB. The browser only needs segments for the ~12 candidate videos from Step A, so it fetches
12 small files instead of one huge one. This is a "two-stage retrieval": a cheap coarse search
over everything, then a fine search over a small subset.

**Resumable, idempotent jobs.** A job that may be interrupted (rate limits, blocks) must be safe
to rerun: cache every result, skip what is done, remember permanent failures (no transcript) so
they are not retried, but retry temporary ones (blocked).

**Same model, same build.** Segments are embedded with fastembed's quantized bge-small, exactly
what HackerTube used for video vectors, so segment and video vectors live in the same space.

### Options considered

| Choice | Options | Picked | Why |
|---|---|---|---|
| Where to fetch | GitHub Actions, home PC, paid proxy | Actions with home-PC fallback | Actions IPs are often blocked by YouTube; proxies cost money. Transcripts rarely change, so one home run is acceptable. |
| What to publish | full text, snippet + embeddings, embeddings only | snippet + embeddings | Full transcripts are creators' content; embeddings alone give nothing to show the student. |
| Segment length | fixed 30 s, 60-90 s, by topic shift | 60-90 s | Long enough for a full explanation, short enough for a precise start. Topic-shift detection is a possible later upgrade. |

### Finding that affects testing

Only **one** of the 3,008 videos mentions Hadoop or MapReduce (a Strata 2014 keynote). HackerTube
is what Hacker News recommends, and HN rarely recommends Hadoop lectures. The Big Data test in step
10 will likely match general distributed-systems videos (e.g. MIT 6.824 talks) rather than
Hadoop-specific ones. That is a coverage limit of the data, not a retrieval bug.

---

## Build steps 4-5: PDF extraction, chunking, embeddings, retrieval

**Date:** 2026-11-03

### What was built (all in `src/core/`, 42 tests passing with `npm test`)

- `pdf.ts`: pdf.js reads each page's text lines with font sizes, in a Web Worker.
- `chunk.ts`: removes lines repeated on more than half the pages (slide footers, course names),
  detects headings, and packs text into chunks of up to 350 words (target 300), under bge's 512-token
  limit. Chunks under 8 words are dropped.
- `embed.ts`: Transformers.js runs `Xenova/bge-small-en-v1.5` (8-bit quantized), CLS pooling,
  normalized, no prefix. Uses WebGPU when the browser has it, otherwise WebAssembly.
- `f16.ts`: decodes float16 bytes into float32 by hand (bit manipulation).
- `data.ts`: loads videos, the embedding matrix, and per-video segments on demand.
- `retrieve.ts`: two-step retrieval; `index.ts`: one entry point, `analyzePdf(file, onProgress)`.

### Key concepts

**Tokens and the 512 limit.** Models read tokens (word pieces), not words. English is about 1.3
tokens per word, so 350 words is roughly 450 tokens. Text past 512 tokens is silently cut off,
which is why chunks are sized by words with a safety margin.

**CLS pooling.** A BERT-style model outputs one vector per token. bge was trained so that the
vector of the special first token (`[CLS]`) represents the whole text. Other models average all
token vectors (mean pooling). Using the wrong pooling gives vectors in a different space.

**Proving compatibility.** HackerTube's vectors came from fastembed in Python; ours come from
Transformers.js in JavaScript. The test embeds three video titles in node and checks each video is
found near the top of HackerTube's matrix: ranks 0, 1 and 0. Same space, confirmed.

**Quantization (q8).** Weights stored as 8-bit integers instead of 32-bit floats: the model
download is about 4x smaller (~34 MB) at a tiny accuracy cost. HackerTube used a quantized build
too.

**Two-step retrieval and score aggregation.** Step A: every chunk votes for its 20 most similar
videos; a video's total is the sum of the similarities it received, times a small boost (up to
+10%) from HackerTube's quality score. Summing rewards videos that explain many parts of the course.
Step B: in the 12 best videos, find the single segment closest to the chunks that voted for it;
its start time is where playback begins.

**Float16 decoding.** 1 sign bit, 5 exponent bits, 10 mantissa bits. Value =
(-1)^sign * 2^(exp-15) * (1 + mantissa/1024), with special cases for zero, subnormals (exp = 0) and
infinity/NaN (exp = 31). The tests check each case.

### Options considered

| Choice | Options | Picked | Why |
|---|---|---|---|
| Aggregation | max similarity, sum of top-K, mean | sum of top-K | Max favors one lucky chunk; mean punishes videos that cover one chapter well. Sum rewards coverage while K cuts noise. |
| Model precision | fp32, fp16, q8 | q8 | Smallest download, matches HackerTube's quantized build; overridable. |
| Score display | absolute cosine, relative to best | relative (best = 1.0) | Easy to rank, but hides "nothing matched well". Revisit in step 6: add an absolute threshold so weak results say so. |

### Open points

- The pdf.js worker import has been type-checked but not yet run in a real browser build (checked
  when the UI is wired).
- The heading detector is untuned; it gets tuned on the real Big Data and PLC/VHDL PDFs in step 10.

---

## Coverage notice: "it's the catalog, not the app"

**Date:** 2026-11-03

### Why

HackerTube only contains videos Hacker News readers recommended again and again (at least 3
people, in at least 3 different months). It is strong on programming, CS, math and science talks
and thin on specialized course topics: there is 1 Hadoop video in 3,008. Retrieval always returns
*something*, so without a notice a student would see loosely related videos and blame the app.

### What was built

- `src/core/coverage.ts`: `assessCoverage` checks each PDF chunk's best video similarity against
  `COVERAGE_THRESHOLD = 0.74` and returns `{level: good | partial | limited, coveredChunks,
  totalChunks, gaps}` (up to 5 weakly covered topic names). 6 table-driven tests.
- `analyzePdf` now returns `coverage`; each `Match` carries its absolute `similarity`.
- The UI shows a neutral info box for partial/limited coverage explaining that the gap comes from
  the source catalog, plus a "Loose match" label on videos below the threshold.

### Key concepts

**Relative vs. absolute scores.** The match score is relative (best match = 1.0), which is good for
ranking but always looks confident. Cosine similarity is absolute: it says how close the best
video actually is. Honest UIs need both: one to order results, one to say "nothing fits well".

**Calibrating a threshold with real data.** Instead of guessing, we embedded 11 test topics and
looked at the best similarity. Covered topics: 0.76-0.82. Missing topics (Hadoop, HDFS, PLC ladder
logic, VHDL, bookkeeping, organic chemistry): 0.65-0.73. 0.74 sits in the gap. bge-small scores
cluster high (even unrelated texts get ~0.6), so thresholds for this model are always in the 0.7s.

**Coverage share.** good: at least 60% of chunks covered; partial: 30-60%; limited: below 30%.

### Options considered

| Option | Trade-off |
|---|---|
| **Threshold on best chunk similarity** (chosen) | Simple, explainable, calibrated on real topics. One number to retune. |
| Gap between top-1 and top-3 similarity | Flat score lists hint at "no real match", but the signal was noisy in the test set. |
| Ask Laya "does this video explain this chunk?" | More precise in theory, but Laya is near chance zero-shot (step 2 findings). Revisit in step 6. |
| No notice, show results anyway | Misleads students into thinking the app failed. |
