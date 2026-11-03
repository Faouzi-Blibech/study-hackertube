# Step 10: real course PDFs (2026-11-03)

Run in headless Chromium against the dev build. PDFs are local course files, not in the repo.

| PDF | Sections | Time | Course identified | Close matches |
|---|---|---|---|---|
| Big Data ch.1 Introduction | 59 | 43 s | Systems > Databases & storage (94%), also Distributed systems | 4/59, limited |
| Big Data ch.2 Apache Hadoop | 61 | 36 s | Systems > Databases & storage (90%) | 0/61, limited |
| Big Data ch.4 Processing Concepts | 53 | 21 s | Systems > Databases & storage (80%) | 2/53, limited |
| MapReduce paper (Dean & Ghemawat) | 51 | 43 s | Systems > Databases & storage (68%) | 15/51, limited |
| PLC course notes 1 | 18 | 27 s | Hardware > Computer architecture & CPUs (44%), also Electronics | 2/18, limited |
| VHDL exercises (lecture 2) | - | 1 s | - | scanned PDF: 0 extractable characters, "No readable text" shown |

Findings
- Course identification is right on every text PDF; confidence drops sensibly for the PLC notes,
  where HackerTube has no PLC category.
- Coverage is "limited" for all of them. For Big Data and PLC that matches the catalog (1 Hadoop
  video in 3,008). The 0.74 threshold was calibrated on short clean queries; long slide chunks
  score lower, so it may be strict for well-covered courses. Retune with a covered course
  (e.g. linear algebra or ML lecture notes) before trusting the exact counts.
- Start times are mostly 0:00 until more transcripts are fetched (background job).
- Scanned PDFs need OCR (e.g. tesseract.js) to work; not in scope yet.
- Opera GX: extension loads via opera://extensions, opens in a tab (no side panel API), and
  returned Kleppmann's "Turning the database inside out" for the Hadoop chapter.
