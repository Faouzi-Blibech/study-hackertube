"""Build public/data/galaxy.json: a 3D layout of the catalog for the topic galaxy.

Method (deterministic, numpy only):
  1. Category centroid = mean embedding of the videos whose FIRST category it is
     (fallback: videos listing it at all). Area centroid = mean of its category centroids.
  2. Category position = PCA(3) of the centroids, blended 35% toward their area's mean so
     each of the 16 areas reads as a clump, then a few repulsion steps to avoid overlaps.
  3. A video sits at its first category's position plus a small offset: its residual
     embedding (video - category centroid) projected on the residuals' own top-3 PCA axes.
Coordinates are scaled uniformly into [-1, 1] and rounded to 3 decimals.

Usage: python -I scripts/build_galaxy.py
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
SEED = 8
AREA_BLEND = 0.35
VIDEO_SPREAD = 0.075  # fraction of the galaxy radius


def pca3(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (scores [n,3], axes [3,d]) of the top-3 principal components."""
    mean = x.mean(axis=0)
    _, _, vt = np.linalg.svd(x - mean, full_matrices=False)
    axes = vt[:3]
    return (x - mean) @ axes.T, axes


def main() -> None:
    videos = json.loads((DATA / "videos.json").read_text(encoding="utf-8"))
    taxonomy = json.loads((DATA / "taxonomy.json").read_text(encoding="utf-8"))
    emb = np.fromfile(DATA / "video_emb.f16", dtype="<f2").astype(np.float32).reshape(len(videos), -1)
    rng = np.random.default_rng(SEED)

    cats = [(c["id"], c["name"], a["id"]) for a in taxonomy["areas"] for c in a["categories"]]
    index = {cid: k for k, (cid, _, _) in enumerate(cats)}
    first = np.array([index.get(v["categories"][0], -1) if v["categories"] else -1 for v in videos])

    cent = np.zeros((len(cats), emb.shape[1]), dtype=np.float32)
    for k, (cid, _, _) in enumerate(cats):
        rows = np.where(first == k)[0]
        if rows.size == 0:
            rows = np.array([i for i, v in enumerate(videos) if cid in v["categories"]], dtype=int)
        if rows.size == 0:
            cent[k] = rng.normal(size=emb.shape[1])  # empty category: still gets a place
        else:
            cent[k] = emb[rows].mean(axis=0)

    pos, _ = pca3(cent)
    pos /= np.abs(pos).max()
    areas = sorted({a for _, _, a in cats})
    area_of = np.array([areas.index(a) for _, _, a in cats])
    for a in range(len(areas)):
        m = area_of == a
        pos[m] = (1 - AREA_BLEND) * pos[m] + AREA_BLEND * pos[m].mean(axis=0)
    for _ in range(40):  # gentle repulsion so category labels do not stack
        d = pos[:, None, :] - pos[None, :, :]
        dist = np.linalg.norm(d, axis=2) + np.eye(len(pos))
        push = (d / dist[..., None] * np.clip(0.12 - dist, 0, None)[..., None]).sum(axis=1)
        pos += 0.5 * push
    pos -= pos.mean(axis=0)
    scale = np.abs(pos).max()

    base = np.array([pos[f] if f >= 0 else (0.0, 0.0, 0.0) for f in first])
    resid = emb - np.array([cent[f] if f >= 0 else emb.mean(axis=0) for f in first])
    off, _ = pca3(resid)
    off /= np.abs(off).max()
    off = off * VIDEO_SPREAD * scale + rng.normal(scale=0.004 * scale, size=off.shape)
    vpos = base + off

    k = 0.98 / max(np.abs(vpos).max(), np.abs(pos).max())
    out = {
        "categories": [
            {"id": cid, "name": name, "area": area,
             "x": round(float(pos[n, 0] * k), 3), "y": round(float(pos[n, 1] * k), 3), "z": round(float(pos[n, 2] * k), 3)}
            for n, (cid, name, area) in enumerate(cats)
        ],
        "videos": [
            {"i": i, "x": round(float(vpos[i, 0] * k), 3), "y": round(float(vpos[i, 1] * k), 3), "z": round(float(vpos[i, 2] * k), 3)}
            for i in range(len(videos))
        ],
    }
    path = DATA / "galaxy.json"
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} kB): {len(out['categories'])} categories, {len(out['videos'])} videos")


if __name__ == "__main__":
    main()
