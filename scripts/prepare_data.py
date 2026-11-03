"""Build the browser data files from the raw HackerTube export.

Reads data/raw/, writes public/data/:
  videos.json      filtered, deduplicated educational videos (same order as the embedding rows)
  video_emb.f16    raw little-endian float16 matrix [count, 384], L2-normalized
  taxonomy.json    16 areas / 150 categories (copied, compact)
  manifest.json    counts, dims, dtype, source credit

Usage: python -I scripts/prepare_data.py
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"

EDU_TYPES = {"lecture", "course", "tutorial", "explainer", "talk"}
KEEP_FIELDS = ("vid", "title", "channel", "summary", "content_type", "level", "primary_topic", "tags", "score")


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def select(videos: list[dict]) -> list[dict]:
    """Educational, non-news videos; duplicates (same normalized title) keep the best score."""
    best: dict[str, dict] = {}
    for v in videos:
        if v["content_type"] not in EDU_TYPES or v["shelf_life"] == "news":
            continue
        key = norm_title(v["title"])
        if key not in best or v["score"] > best[key]["score"]:
            best[key] = v
    return sorted(best.values(), key=lambda v: -v["score"])


def compact(v: dict) -> dict:
    out = {k: v[k] for k in KEEP_FIELDS}
    out["categories"] = [c["id"] for c in v["categories"]]
    out["area"] = v["categories"][0]["area"] if v["categories"] else None
    return out


def main() -> int:
    videos = [json.loads(line) for line in open(RAW / "videos.jsonl", encoding="utf-8")]
    ids = json.load(open(RAW / "embedding_ids.json", encoding="utf-8"))
    emb = np.load(RAW / "embeddings.npy")
    assert emb.shape == (len(ids), 384) and emb.dtype == np.float16, (emb.shape, emb.dtype)
    row = {vid: i for i, vid in enumerate(ids)}

    kept = [v for v in select(videos) if v["vid"] in row]
    matrix = emb[[row[v["vid"]] for v in kept]].astype("<f2")

    # Sanity: rows are unit length and line up with the video order.
    norms = np.linalg.norm(matrix.astype(np.float32), axis=1)
    assert np.allclose(norms, 1.0, atol=1e-2), (norms.min(), norms.max())
    assert np.array_equal(matrix[0], emb[row[kept[0]["vid"]]])

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "videos.json").write_text(
        json.dumps([compact(v) for v in kept], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    matrix.tofile(OUT / "video_emb.f16")
    taxonomy = json.load(open(RAW / "taxonomy.json", encoding="utf-8"))
    (OUT / "taxonomy.json").write_text(
        json.dumps(taxonomy, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    manifest = {
        "count": len(kept),
        "dims": 384,
        "dtype": "float16-le",
        "model": "BAAI/bge-small-en-v1.5",
        "source": "HackerTube (https://hackertube.org), ODC-By 1.0",
        "content_types": sorted(EDU_TYPES),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    dropped_dupes = sum(1 for v in videos if v["content_type"] in EDU_TYPES and v["shelf_life"] != "news") - len(kept)
    print(f"videos: {len(videos)} raw -> {len(kept)} kept ({dropped_dupes} duplicates/unembedded dropped)")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name}: {f.stat().st_size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
