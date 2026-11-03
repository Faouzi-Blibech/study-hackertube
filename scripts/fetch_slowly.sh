#!/usr/bin/env bash
# Fetch all transcripts from a home connection without tripping YouTube's rate limit for long.
# Slow pace with jitter; when YouTube blocks (exit 2), wait and resume. Gives up after
# MAX_ROUNDS blocked rounds in a row that fetched nothing.
# Usage: bash scripts/fetch_slowly.sh   (from the repo root, with .venv set up)
set -u
PY=.venv/Scripts/python
[ -x "$PY" ] || PY=.venv/bin/python
WAIT=${WAIT:-2700}      # seconds to wait after a block (45 min)
MAX_ROUNDS=${MAX_ROUNDS:-4}
idle=0
while true; do
  before=$(ls data/transcripts | wc -l)
  "$PY" -I scripts/fetch_transcripts.py --student-first --sleep 6 --jitter 4
  code=$?
  after=$(ls data/transcripts | wc -l)
  echo "round done: exit=$code new=$((after - before)) total=$after $(date +%H:%M)"
  [ "$code" -ne 2 ] && break
  if [ "$after" -eq "$before" ]; then idle=$((idle + 1)); else idle=0; fi
  [ "$idle" -ge "$MAX_ROUNDS" ] && { echo "giving up: blocked $idle rounds in a row"; break; }
  sleep "$WAIT"
done
"$PY" -I scripts/build_segments.py
