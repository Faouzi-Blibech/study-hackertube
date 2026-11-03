#!/usr/bin/env python3
"""Cut cached transcripts into ~60-90 s segments and embed them.

Reads data/transcripts/<vid>.json. Writes, per vid:
  public/data/segments/<vid>.json  {"vid", "segments":[{"start","end","snippet"}]}
  public/data/segments/<vid>.f16   float16 little-endian, [n_segments, 384], L2-normalized
and public/data/segments/index.json (sorted vids). Full transcript text is NOT published.
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TRANSCRIPTS = ROOT / "data" / "transcripts"
OUT = ROOT / "public" / "data" / "segments"
MODEL = "BAAI/bge-small-en-v1.5"
DIM = 384
TARGET = 60.0   # close a segment once it reaches this duration
MAX_LEN = 90.0  # never extend a segment past this unless a single snippet is longer
MIN_TAIL = 30.0  # a trailing remainder shorter than this merges into the previous segment
SNIPPET_CHARS = 160


def clean(t):
    return re.sub(r"\s+", " ", t.replace("\n", " ")).strip()


def make_segments(snippets):
    """Return list of dicts {start,end,text}; breaks only at snippet boundaries."""
    items = []
    for i, s in enumerate(snippets):
        text = clean(s["text"])
        if not text:
            continue
        start = float(s["start"])
        end = start + float(s["duration"])
        if i + 1 < len(snippets):  # auto captions overlap; clamp to next start
            end = min(end, max(start, float(snippets[i + 1]["start"])))
        items.append((start, end, text))
    segs, cur = [], None
    for start, end, text in items:
        if cur is not None and end - cur["start"] > MAX_LEN and cur["end"] - cur["start"] >= 30:
            segs.append(cur)
            cur = None
        if cur is None:
            cur = {"start": start, "end": end, "parts": [text]}
        else:
            cur["end"] = max(cur["end"], end)
            cur["parts"].append(text)
        if cur["end"] - cur["start"] >= TARGET:
            segs.append(cur)
            cur = None
    if cur is not None:
        if segs and cur["end"] - cur["start"] < MIN_TAIL:
            segs[-1]["end"] = max(segs[-1]["end"], cur["end"])
            segs[-1]["parts"] += cur["parts"]
        else:
            segs.append(cur)
    return [{"start": s["start"], "end": s["end"], "text": " ".join(s["parts"])} for s in segs]


def short_snippet(text):
    if len(text) <= SNIPPET_CHARS:
        return text
    cut = text[:SNIPPET_CHARS]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 40 else cut).rstrip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="rebuild vids that already have segment files")
    ap.add_argument("--batch", type=int, default=64)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    todo = []
    for p in sorted(TRANSCRIPTS.glob("*.json")):
        if p.name.startswith("_"):
            continue
        vid = p.stem
        if not args.force and (OUT / f"{vid}.json").exists() and (OUT / f"{vid}.f16").exists():
            continue
        todo.append(p)

    if todo:
        from fastembed import TextEmbedding
        model = TextEmbedding(MODEL)
        for p in todo:
            data = json.loads(p.read_text(encoding="utf8"))
            vid = data["vid"]
            segs = make_segments(data["snippets"])
            if not segs:
                print(f"[skip] {vid}: no segments")
                continue
            emb = np.array(list(model.embed([s["text"] for s in segs], batch_size=args.batch)), dtype=np.float32)
            emb /= np.maximum(np.linalg.norm(emb, axis=1, keepdims=True), 1e-12)
            assert emb.shape == (len(segs), DIM), emb.shape
            meta = {
                "vid": vid,
                "segments": [
                    {"start": round(s["start"], 2), "end": round(s["end"], 2), "snippet": short_snippet(s["text"])}
                    for s in segs
                ],
            }
            (OUT / f"{vid}.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
            (OUT / f"{vid}.f16").write_bytes(emb.astype("<f2").tobytes())
            print(f"[ok] {vid}: {len(segs)} segments")

    vids = sorted(p.stem for p in OUT.glob("*.json") if p.stem != "index" and (OUT / f"{p.stem}.f16").exists())
    (OUT / "index.json").write_text(json.dumps(vids), encoding="utf8")
    print(f"index: {len(vids)} vids")


if __name__ == "__main__":
    main()
