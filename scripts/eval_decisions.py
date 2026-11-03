"""Honest evaluation of the decision layer: embedding method vs Laya zero-shot.

Run with the separate venv:  .venv-laya/Scripts/python.exe scripts/eval_decisions.py
Writes eval/decisions.json (raw numbers) and eval/decisions.md (tables + conclusion).

Benchmarks (ground truth = the LLM-made taxonomy labels in videos.json, a few % noisy):
  1. Course identification (Decision 1): 300 videos, stratified across areas, state = title + summary.
  2. Video relevance (Decision 2 proxy): 100 queries, top-5 embedding candidates, gold = category match.
"""
from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
OUT = ROOT / "eval"
SEED = 7
N_COURSE = 300
N_QUERIES = 100
TOPK = 5
LAYA_SKIP = "--no-laya" in sys.argv
DEVICE = sys.argv[sys.argv.index("--device") + 1] if "--device" in sys.argv else "cpu"


def load():
    videos = json.loads((DATA / "videos.json").read_text(encoding="utf8"))
    emb = np.fromfile(DATA / "video_emb.f16", dtype="<f2").astype(np.float32).reshape(len(videos), -1)
    tax = json.loads((DATA / "taxonomy.json").read_text(encoding="utf8"))
    return videos, emb, tax


def stratified_sample(videos, rng, n):
    by_area: dict[str, list[int]] = {}
    for i, v in enumerate(videos):
        by_area.setdefault(v["area"], []).append(i)
    areas = sorted(by_area)
    base, extra = divmod(n, len(areas))
    bonus = set(rng.sample(areas, extra))
    picked: list[int] = []
    for a in areas:
        k = base + (1 if a in bonus else 0)
        picked += rng.sample(by_area[a], min(k, len(by_area[a])))
    rng.shuffle(picked)
    return picked


def state_text(v):
    return f"{v['title']}. {v['summary']}"


class Centroids:
    """Per-area and per-category sums so leave-one-out centroids are O(1) per video."""

    def __init__(self, videos, emb, tax):
        self.area_ids = [a["id"] for a in tax["areas"]]
        self.cat_area = {c["id"]: a["id"] for a in tax["areas"] for c in a["categories"]}
        self.cat_ids = list(self.cat_area)
        self.a_idx = {a: i for i, a in enumerate(self.area_ids)}
        self.c_idx = {c: i for i, c in enumerate(self.cat_ids)}
        d = emb.shape[1]
        self.a_sum = np.zeros((len(self.area_ids), d), np.float32)
        self.c_sum = np.zeros((len(self.cat_ids), d), np.float32)
        self.a_n = np.zeros(len(self.area_ids))
        self.c_n = np.zeros(len(self.cat_ids))
        for v, e in zip(videos, emb):
            self.a_sum[self.a_idx[v["area"]]] += e
            self.a_n[self.a_idx[v["area"]]] += 1
            c = v["categories"][0]
            self.c_sum[self.c_idx[c]] += e
            self.c_n[self.c_idx[c]] += 1

    @staticmethod
    def _norm(m):
        n = np.linalg.norm(m, axis=-1, keepdims=True)
        return m / np.maximum(n, 1e-9)

    def area_mat(self, exclude_vec=None, exclude_area=None):
        s = self.a_sum.copy()
        if exclude_vec is not None:
            s[self.a_idx[exclude_area]] -= exclude_vec
        return self._norm(s)

    def cat_mat(self, exclude_vec=None, exclude_cat=None):
        s = self.c_sum.copy()
        n = self.c_n.copy()
        if exclude_vec is not None:
            s[self.c_idx[exclude_cat]] -= exclude_vec
            n[self.c_idx[exclude_cat]] -= 1
        return self._norm(s), n > 0


def softmax(x, t):
    z = x / t
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def embedding_predict(cen, e, v, tax_cat_ids_by_area):
    """Leave-one-out centroid prediction for video v with embedding e. Returns (area, cat, area_cos, cat_cos)."""
    cos_a = cen.area_mat(e, v["area"]) @ e
    a = cen.area_ids[int(np.argmax(cos_a))]
    return a, cos_a


def predict_cat(cen, e, v, area_id):
    mat, ok = cen.cat_mat(e, v["categories"][0])
    cos = mat @ e
    allowed = [i for i, c in enumerate(cen.cat_ids) if cen.cat_area[c] == area_id and ok[i]]
    best = max(allowed, key=lambda i: cos[i])
    return cen.cat_ids[best], cos, allowed


def run_embedding_course(videos, emb, tax, cen, idxs):
    t0 = time.perf_counter()
    rows = []
    for i in idxs:
        v, e = videos[i], emb[i]
        a, cos_a = embedding_predict(cen, e, v, None)
        c, cos_c, allowed = predict_cat(cen, e, v, a)
        c_gold_area, _, _ = predict_cat(cen, e, v, v["area"])
        rows.append(dict(i=i, area=a, cat=c, cat_given_gold_area=c_gold_area, cos_a=cos_a, cos_c=cos_c, allowed=allowed))
    dt = (time.perf_counter() - t0) / len(idxs)
    return rows, dt


def accuracy(videos, rows):
    n = len(rows)
    a = sum(r["area"] == videos[r["i"]]["area"] for r in rows) / n
    c = sum(r["cat"] == videos[r["i"]]["categories"][0] for r in rows) / n
    cg = sum(r["cat_given_gold_area"] == videos[r["i"]]["categories"][0] for r in rows) / n
    return dict(area_acc=a, cat_acc=c, cat_acc_given_gold_area=cg, n=n)


def calibrate(videos, cen, rows):
    """Grid-search the softmax temperature that minimises NLL of the gold label (area and category)."""
    grid = [0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.07, 0.1, 0.15]
    out = {"area": {}, "category": {}}
    for t in grid:
        nll_a = []
        nll_c = []
        for r in rows:
            v = videos[r["i"]]
            p = softmax(r["cos_a"], t)
            nll_a.append(-np.log(max(p[cen.a_idx[v["area"]]], 1e-12)))
            if v["categories"][0] in [cen.cat_ids[j] for j in r["allowed"]]:
                # categories restricted to the predicted area; only score rows whose gold lies inside it
                cos = r["cos_c"][r["allowed"]]
                p = softmax(cos, t)
                k = [cen.cat_ids[j] for j in r["allowed"]].index(v["categories"][0])
                nll_c.append(-np.log(max(p[k], 1e-12)))
        out["area"][t] = float(np.mean(nll_a))
        out["category"][t] = float(np.mean(nll_c))
    out["best_area_T"] = min(out["area"], key=out["area"].get)
    out["best_category_T"] = min(out["category"], key=out["category"].get)
    out["area"] = {str(k): v for k, v in out["area"].items()}
    out["category"] = {str(k): v for k, v in out["category"].items()}
    return out


# ---------------------------------------------------------------- Laya (zero-shot, English checkpoint)
class LayaDecider:
    """Thin wrapper over laya.Router.predict. API (from laya 0.4.21 source, router.py/presets.py):
    questions = {name: {"type": "choice", "instructions": str, "criteria": {label: description}}}
    result["answers"][name]["choice"], ["probabilities"], result["usage"]["truncated"]."""

    def __init__(self, tax):
        from laya import Router

        self.router = Router(device=DEVICE)
        self.area_criteria = {
            a["id"]: f"{a['name']}: " + ", ".join(c["name"] for c in a["categories"]) for a in tax["areas"]
        }
        self.cat_criteria = {
            a["id"]: {c["id"]: f"{c['name']}: {c['description']}"[:220] for c in a["categories"]} for a in tax["areas"]
        }
        self.truncated = 0
        self.calls = 0
        self.tokens: list[int] = []
        self.area("warm-up call so model load and kernel compilation are not timed")
        self.truncated = self.calls = 0
        self.tokens = []

    def _choice(self, state: dict, instructions: str, criteria: dict):
        q = {"q": {"type": "choice", "instructions": instructions, "criteria": criteria}}
        r = self.router.predict(state, q, model="english")
        u = r.get("usage", {})
        self.calls += 1
        self.truncated += int(bool(u.get("truncated")))
        self.tokens.append(int(u.get("input_tokens", 0)))
        ans = r["answers"]["q"]
        return ans["choice"], ans.get("probabilities", {})

    def area(self, text):
        return self._choice({"video": text}, "Which subject area does the video described in `video` belong to?", self.area_criteria)

    def category(self, text, area_id):
        return self._choice({"video": text}, "Which topic category does the video described in `video` belong to?", self.cat_criteria[area_id])

    def best_video(self, query, cand_texts):
        crit = {f"v{k + 1}": t for k, t in enumerate(cand_texts)}
        return self._choice({"topic": query}, "Which video best explains the topic in `topic`?", crit)


def run_laya_course(videos, idxs, dec, cen):
    rows, times = [], []
    for n, i in enumerate(idxs):
        v = videos[i]
        text = state_text(v)
        t0 = time.perf_counter()
        a, _ = dec.area(text)
        c, _ = dec.category(text, a)
        times.append(time.perf_counter() - t0)
        cg = dec.category(text, v["area"])[0]  # category given the gold area (diagnostic)
        rows.append(dict(i=i, area=a, cat=c, cat_given_gold_area=cg))
        if n % 25 == 0:
            print(f"  laya course {n}/{len(idxs)}", flush=True)
    return rows, float(np.mean(times)) / 2  # two choice calls per course decision; report per call too


# ---------------------------------------------------------------- embed-taxonomy-text variant (fastembed)
def embedding_taxonomy_text(videos, emb, tax, idxs):
    from fastembed import TextEmbedding

    model = TextEmbedding("BAAI/bge-small-en-v1.5")
    area_txt = [f"{a['name']}: " + ", ".join(c["name"] for c in a["categories"]) for a in tax["areas"]]
    a_emb = np.array(list(model.embed(area_txt)), np.float32)
    cat_emb, cat_ids, cat_area = [], [], []
    for a in tax["areas"]:
        for c in a["categories"]:
            cat_ids.append(c["id"]); cat_area.append(a["id"])
    cat_emb = np.array(list(model.embed([c["description"] for a in tax["areas"] for c in a["categories"]])), np.float32)
    ok_a = ok_c = 0
    for i in idxs:
        v, e = videos[i], emb[i]
        a = tax["areas"][int(np.argmax(a_emb @ e))]["id"]
        ok_a += a == v["area"]
        sc = cat_emb @ e
        best = max((k for k in range(len(cat_ids)) if cat_area[k] == a), key=lambda k: sc[k])
        ok_c += cat_ids[best] == v["categories"][0]
    return dict(area_acc=ok_a / len(idxs), cat_acc=ok_c / len(idxs))


# ---------------------------------------------------------------- Benchmark 2: video relevance
def build_queries(videos, emb, tax, rng, embed_fn, n_total=N_QUERIES):
    cats = [(c["id"], c["description"]) for a in tax["areas"] for c in a["categories"]]
    rng.shuffle(cats)
    out, dropped = [], 0
    total = n_total
    for kind, source, quota in (("category_description", None, total // 2), ("video_tag", None, total)):
        got = 0
        pool = cats if kind == "category_description" else None
        n = 0
        while got < quota and len(out) < total:
            n += 1
            if kind == "category_description":
                if not pool:
                    break
                cid, text = pool.pop()
                src = None
            else:
                src = rng.randrange(len(videos))
                if not videos[src]["tags"]:
                    continue
                text = rng.choice(videos[src]["tags"])
                cid = videos[src]["categories"][0]
            q = embed_fn([text])[0]
            sims = emb @ q
            if src is not None:
                sims[src] = -9
            cand = [int(j) for j in np.argsort(-sims)[:TOPK]]
            gold = [cid in videos[j]["categories"] for j in cand]
            if not (0 < sum(gold) < TOPK):
                dropped += 1  # trivial (no or all candidates relevant): cannot tell the rankers apart
                continue
            out.append(dict(kind=kind, text=text, cat=cid, cand=cand, gold=gold))
            got += 1
    return out, dropped


def run_relevance(videos, queries, dec):
    emb_ok = lay_ok = rand = 0
    times = []
    for n, q in enumerate(queries):
        emb_ok += q["gold"][0]
        rand += sum(q["gold"]) / len(q["gold"])
        texts = [f"{videos[j]['title']}: {videos[j]['summary']}"[:400] for j in q["cand"]]
        if dec is not None:
            t0 = time.perf_counter()
            pick, _ = dec.best_video(q["text"], texts)
            times.append(time.perf_counter() - t0)
            lay_ok += q["gold"][int(pick[1:]) - 1]
            if n % 20 == 0:
                print(f"  laya relevance {n}/{len(queries)}", flush=True)
    n = len(queries)
    return dict(n=n, embedding_p1=emb_ok / n, laya_p1=(lay_ok / n if dec is not None else None),
                random_p1=rand / n, laya_sec=(float(np.mean(times)) if times else None))


# ---------------------------------------------------------------- aggregation study (mean vs vote)
def pseudo_courses(videos, emb, cen, rng, T, noise, n=200, size=8):
    by_cat: dict[str, list[int]] = {}
    for i, v in enumerate(videos):
        by_cat.setdefault(v["categories"][0], []).append(i)
    big = sorted(c for c, l in by_cat.items() if len(l) >= size + 4)
    res = dict(mean_area=0, vote_area=0, mean_cat=0, vote_cat=0)
    for _ in range(n):
        cat = rng.choice(big)
        grp = rng.sample(by_cat[cat], size)
        others = [i for i, v in enumerate(videos) if v["area"] != videos[grp[0]]["area"]]
        nz = rng.sample(others, noise)
        chunks = grp + nz
        a_sum, c_sum, c_n = cen.a_sum.copy(), cen.c_sum.copy(), cen.c_n.copy()
        for i in chunks:  # remove every chunk video from the centroids
            a_sum[cen.a_idx[videos[i]["area"]]] -= emb[i]
            c_sum[cen.c_idx[videos[i]["categories"][0]]] -= emb[i]
            c_n[cen.c_idx[videos[i]["categories"][0]]] -= 1
        A, C = Centroids._norm(a_sum), Centroids._norm(c_sum)
        X = emb[chunks]
        gold_area = videos[grp[0]]["area"]
        # mean: average chunk embeddings, normalise, softmax over areas
        m = X.mean(0); m /= np.linalg.norm(m)
        p_mean = softmax(A @ m, T)
        # vote: per-chunk softmax, summed
        p_vote = sum(softmax(A @ x, T) for x in X)
        res["mean_area"] += cen.area_ids[int(np.argmax(p_mean))] == gold_area
        res["vote_area"] += cen.area_ids[int(np.argmax(p_vote))] == gold_area
        for name, a_pred in (("mean", cen.area_ids[int(np.argmax(p_mean))]), ("vote", cen.area_ids[int(np.argmax(p_vote))])):
            allowed = [k for k, c in enumerate(cen.cat_ids) if cen.cat_area[c] == a_pred and c_n[k] > 0]
            if name == "mean":
                s = C[allowed] @ m
            else:
                s = sum(softmax(C[allowed] @ x, T) for x in X)
            res[f"{name}_cat"] += cen.cat_ids[allowed[int(np.argmax(s))]] == cat
    return {k: v / n for k, v in res.items()} | dict(n=n, chunks=size + noise, noise_chunks=noise)


def main():
    quick = "--quick" in sys.argv
    n_course, n_q = (12, 6) if quick else (N_COURSE, N_QUERIES)
    videos, emb, tax = load()
    rng = random.Random(SEED)
    cen = Centroids(videos, emb, tax)
    idxs = stratified_sample(videos, rng, n_course)
    result: dict = dict(seed=SEED, n_videos=len(videos), n_course=len(idxs), laya_device=DEVICE)

    # 1a. embedding centroids, leave-one-out
    rows, dt = run_embedding_course(videos, emb, tax, cen, idxs)
    result["course_embedding"] = accuracy(videos, rows) | dict(sec_per_prediction=dt)
    result["calibration"] = calibrate(videos, cen, rows)
    result["prior_majority_area"] = max(sum(v["area"] == a for v in videos) for a in cen.area_ids) / len(videos)
    print("embedding", result["course_embedding"], "T", result["calibration"]["best_area_T"], result["calibration"]["best_category_T"], flush=True)

    # 1a'. zero-shot embedding of taxonomy text (cheap with fastembed)
    result["course_embedding_taxonomy_text"] = embedding_taxonomy_text(videos, emb, tax, idxs)
    print("taxonomy text", result["course_embedding_taxonomy_text"], flush=True)

    # aggregation study with the calibrated temperature
    T = float(result["calibration"]["best_area_T"])
    result["aggregation"] = {
        f"noise_{k}": pseudo_courses(videos, emb, cen, random.Random(SEED + 1), T, k, n=40 if quick else 300)
        for k in (0, 3)
    }
    print("aggregation", result["aggregation"], flush=True)

    # 2. relevance queries (fastembed for query text)
    from fastembed import TextEmbedding

    bge = TextEmbedding("BAAI/bge-small-en-v1.5")
    embed_fn = lambda texts: np.array(list(bge.embed(texts)), np.float32)  # noqa: E731
    queries, dropped = build_queries(videos, emb, tax, random.Random(SEED + 2), embed_fn, n_q)
    result["relevance_dropped_trivial_queries"] = dropped
    result["relevance_query_kinds"] = {k: sum(q["kind"] == k for q in queries) for k in ("category_description", "video_tag")}

    dec = None
    if not LAYA_SKIP:
        dec = LayaDecider(tax)
        lrows, lt = run_laya_course(videos, idxs, dec, cen)
        result["course_laya"] = accuracy(videos, lrows) | dict(
            sec_per_prediction=lt * 2, sec_per_choice_call=lt, truncated_calls=dec.truncated,
            calls=dec.calls, mean_input_tokens=float(np.mean(dec.tokens)), max_input_tokens=int(max(dec.tokens)))
        print("laya", result["course_laya"], flush=True)
    result["relevance"] = run_relevance(videos, queries, dec)
    print("relevance", result["relevance"], flush=True)

    if not quick:
        OUT.mkdir(exist_ok=True)
        (OUT / "decisions.json").write_text(json.dumps(result, indent=2), encoding="utf8")
        (OUT / "decisions.md").write_text(render_md(result), encoding="utf8")
        print("wrote eval/decisions.json and eval/decisions.md")


def pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


def conclusion(r):
    e, l, rel = r["course_embedding"], r.get("course_laya"), r["relevance"]
    if not l or rel["laya_p1"] is None:
        return ["## Conclusion", "", "Laya was not run (--no-laya)."]
    d_area = 100 * (l["area_acc"] - e["area_acc"])
    d_p1 = 100 * (rel["laya_p1"] - rel["embedding_p1"])
    win = d_area >= 5 or d_p1 >= 5
    return [
        "## Conclusion",
        "",
        f"1. Decision rule (Laya must beat embeddings by >= 5 points on area accuracy or precision@1): area {d_area:+.1f} points, precision@1 {d_p1:+.1f} points -> "
        + ("Laya qualifies." if win else "Laya does NOT qualify; the product uses the embedding method."),
        f"2. Zero-shot Laya is far from the embedding centroids on course identification (area {pct(l['area_acc'])} vs {pct(e['area_acc'])}), as the model card warns for non-fine-tuned checkpoints. The centroids use ~3000 labeled videos, so the fair zero-shot comparison is the taxonomy-text embedding: {pct(r['course_embedding_taxonomy_text']['area_acc'])} area vs Laya {pct(l['area_acc'])}.",
        "3. Category accuracy has the same gap; Laya clamps temperatures for choices with 11+ options (runtime warning), so 16-way area choice is also poorly calibrated.",
        "4. Caveats: labels are LLM-made (a few percent noise); Laya prompts used taxonomy names/descriptions, no prompt tuning; the typed-decisions checkpoint and fine-tuning were not tried.",
        f"5. Cost: Laya = 421M-parameter model, ~{1000 * l['sec_per_prediction']:.0f} ms per two-step prediction on the RTX 4070 and ~1.4 s on CPU (12-sample timing run), not runnable in the browser; embeddings = ~0.1 ms on data the page already loads.",
    ]


def render_md(r):
    e, l, tt = r["course_embedding"], r.get("course_laya"), r["course_embedding_taxonomy_text"]
    rel, cal, agg = r["relevance"], r["calibration"], r["aggregation"]
    lines = [
        "# Decision layer evaluation: embedding vs Laya (zero-shot)",
        "",
        f"Seed {r['seed']}. Ground truth = taxonomy labels in videos.json, made by an LLM (a few percent noise,",
        "so absolute accuracy has a ceiling below 100% and small gaps are within noise). Laya = English checkpoint,",
        "zero-shot, laya 0.4.21 (run on the GPU for speed; CPU timing noted below). Embedding = bge-small centroids per area/category, leave-one-out.",
        "",
        f"## 1. Course identification ({r['n_course']} videos, stratified by area, state = title + summary)",
        "",
        "| Method | Area top-1 | Category top-1 (pipeline) | Category top-1 (gold area given) | Time / prediction |",
        "|---|---|---|---|---|",
        f"| Embedding centroids (LOO) | {pct(e['area_acc'])} | {pct(e['cat_acc'])} | {pct(e['cat_acc_given_gold_area'])} | {1000 * e['sec_per_prediction']:.2f} ms |",
        f"| Embedding of taxonomy text (zero-shot) | {pct(tt['area_acc'])} | {pct(tt['cat_acc'])} | - | < 1 ms |",
    ]
    if l:
        lines.append(f"| Laya zero-shot (2 choice calls) | {pct(l['area_acc'])} | {pct(l['cat_acc'])} | {pct(l['cat_acc_given_gold_area'])} | {1000 * l['sec_per_prediction']:.0f} ms |")
        lines += ["", f"Laya prompt size: mean {l['mean_input_tokens']:.0f} tokens, max {l['max_input_tokens']}; "
                  f"{l['truncated_calls']} of {l['calls']} calls truncated (512-token limit)."]
    lines += [
        f"Majority-area baseline (all videos): {pct(r['prior_majority_area'])}; uniform over 16 areas: 6.3%.",
        "",
        "## 2. Video relevance (Decision 2 proxy)",
        "",
        f"{rel['n']} queries ({r['relevance_query_kinds']['category_description']} taxonomy category descriptions, {r['relevance_query_kinds']['video_tag']} video tags), candidates = top 5 by embedding retrieval,",
        f"gold = candidates whose categories contain the query category. {r['relevance_dropped_trivial_queries']} queries were skipped because",
        "all or none of the 5 candidates were relevant (nothing to rank).",
        "",
        "| Ranker | Precision@1 | Time / query |",
        "|---|---|---|",
        f"| Random candidate | {pct(rel['random_p1'])} | - |",
        f"| Embedding order | {pct(rel['embedding_p1'])} | < 1 ms |",
        f"| Laya choice | {pct(rel['laya_p1'])} | {('%.0f ms' % (1000 * rel['laya_sec'])) if rel['laya_sec'] else 'n/a'} |",
        "",
        "## 3. Temperature and aggregation (for the browser implementation)",
        "",
        f"Softmax temperature minimising NLL on the {r['n_course']}-video benchmark: area T = {cal['best_area_T']}, category T = {cal['best_category_T']}.",
        "",
        "| Pseudo-course (8 on-topic chunks) | Mean-embedding area | Vote area | Mean cat | Vote cat |",
        "|---|---|---|---|---|",
    ]
    for k, a in agg.items():
        lines.append(f"| {a['noise_chunks']} off-topic chunks | {pct(a['mean_area'])} | {pct(a['vote_area'])} | {pct(a['mean_cat'])} | {pct(a['vote_cat'])} |")
    lines.append("")
    lines += conclusion(r)
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
