#!/usr/bin/env python3
"""Fetch and cache English YouTube transcripts for videos in public/data/videos.json.

Output: data/transcripts/<vid>.json  {"vid", "language", "generated", "snippets":[{"text","start","duration"}]}
Failures: data/transcripts/_status.json  {vid: reason}; reason in
no_transcript, disabled, blocked, other. Permanent failures are skipped on rerun;
"blocked" is retried. Exit code 2 if stopped early by repeated IP blocks.
"""
import argparse
import random
import json
import sys
import time
from pathlib import Path

from youtube_transcript_api import (
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    YouTubeTranscriptApi,
)

ROOT = Path(__file__).resolve().parent.parent
VIDEOS = ROOT / "public" / "data" / "videos.json"
OUT = ROOT / "data" / "transcripts"
STATUS = OUT / "_status.json"
MAX_CONSECUTIVE_BLOCKS = 3


def load_status():
    if STATUS.exists():
        return json.loads(STATUS.read_text(encoding="utf8"))
    return {}


def save_status(status):
    STATUS.write_text(json.dumps(status, indent=0, sort_keys=True), encoding="utf8")


def pick_transcript(api, vid):
    """Manual English first, then auto-generated English. Raises NoTranscriptFound."""
    tl = api.list(vid)
    langs = ["en", "en-US", "en-GB", "en-CA", "en-AU"]
    try:
        return tl.find_manually_created_transcript(langs)
    except NoTranscriptFound:
        return tl.find_generated_transcript(langs)


def fetch_one(api, vid):
    tr = pick_transcript(api, vid)
    fetched = tr.fetch()
    snippets = [
        {"text": s.text, "start": round(s.start, 3), "duration": round(s.duration, 3)}
        for s in fetched
    ]
    return {
        "vid": vid,
        "language": tr.language_code,
        "generated": bool(tr.is_generated),
        "snippets": snippets,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--limit", type=int, default=0, help="max number of NEW fetch attempts")
    ap.add_argument("--vids", type=str, default="", help="comma-separated video ids (overrides videos.json order)")
    ap.add_argument("--sleep", type=float, default=1.0, help="seconds between videos")
    ap.add_argument("--jitter", type=float, default=0.0, help="extra random 0..J seconds between videos")
    ap.add_argument("--student-first", action="store_true",
                    help="fetch course/lecture/tutorial videos first, then explainers, then talks")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    if args.vids:
        vids = [v.strip() for v in args.vids.split(",") if v.strip()]
    else:
        videos = json.loads(VIDEOS.read_text(encoding="utf8"))
        if args.student_first:
            rank = {"course": 0, "lecture": 0, "tutorial": 0, "explainer": 1, "talk": 2}
            videos.sort(key=lambda v: rank.get(v["content_type"], 3))  # stable: keeps score order
        vids = [v["vid"] for v in videos]

    status = load_status()
    api = YouTubeTranscriptApi()
    attempts = ok = fail = consecutive_blocks = 0
    stopped = False

    for vid in vids:
        if (OUT / f"{vid}.json").exists():
            continue
        if status.get(vid) in ("no_transcript", "disabled", "other"):
            continue
        if args.limit and attempts >= args.limit:
            break
        attempts += 1
        try:
            data = fetch_one(api, vid)
            if not data["snippets"]:
                raise NoTranscriptFound(vid, [], None)
            (OUT / f"{vid}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf8")
            status.pop(vid, None)
            ok += 1
            consecutive_blocks = 0
            print(f"[ok] {vid} {len(data['snippets'])} snippets generated={data['generated']}")
        except (IpBlocked, RequestBlocked):
            status[vid] = "blocked"
            fail += 1
            consecutive_blocks += 1
            print(f"[blocked] {vid} ({consecutive_blocks}/{MAX_CONSECUTIVE_BLOCKS})")
            if consecutive_blocks >= MAX_CONSECUTIVE_BLOCKS:
                save_status(status)
                print(
                    "Stopping: YouTube is blocking this IP (likely a cloud/datacenter IP). "
                    "Run locally from a home IP and commit/cache the results.",
                    file=sys.stderr,
                )
                stopped = True
                break
        except NoTranscriptFound:
            status[vid] = "no_transcript"
            fail += 1
            consecutive_blocks = 0
            print(f"[no_transcript] {vid}")
        except TranscriptsDisabled:
            status[vid] = "disabled"
            fail += 1
            consecutive_blocks = 0
            print(f"[disabled] {vid}")
        except Exception as e:  # noqa: BLE001
            status[vid] = "other"
            fail += 1
            consecutive_blocks = 0
            print(f"[other] {vid} {type(e).__name__}: {str(e)[:120]}")
        if attempts % 10 == 0:
            save_status(status)
        time.sleep(args.sleep + random.uniform(0, args.jitter))

    save_status(status)
    print(f"done: attempted={attempts} ok={ok} failed={fail}")
    sys.exit(2 if stopped else 0)


if __name__ == "__main__":
    main()
