# Decision layer evaluation: embedding vs Laya (zero-shot)

Seed 7. Ground truth = taxonomy labels in videos.json, made by an LLM (a few percent noise,
so absolute accuracy has a ceiling below 100% and small gaps are within noise). Laya = English checkpoint,
zero-shot, laya 0.4.21 (run on the GPU for speed; CPU timing noted below). Embedding = bge-small centroids per area/category, leave-one-out.

## 1. Course identification (300 videos, stratified by area, state = title + summary)

| Method | Area top-1 | Category top-1 (pipeline) | Category top-1 (gold area given) | Time / prediction |
|---|---|---|---|---|
| Embedding centroids (LOO) | 72.0% | 59.0% | 83.7% | 0.16 ms |
| Embedding of taxonomy text (zero-shot) | 65.3% | 50.0% | - | < 1 ms |
| Laya zero-shot (2 choice calls) | 35.3% | 15.3% | 45.7% | 89 ms |

Laya prompt size: mean 255 tokens, max 292; 0 of 900 calls truncated (512-token limit).
Majority-area baseline (all videos): 19.8%; uniform over 16 areas: 6.3%.

## 2. Video relevance (Decision 2 proxy)

100 queries (31 taxonomy category descriptions, 69 video tags), candidates = top 5 by embedding retrieval,
gold = candidates whose categories contain the query category. 188 queries were skipped because
all or none of the 5 candidates were relevant (nothing to rank).

| Ranker | Precision@1 | Time / query |
|---|---|---|
| Random candidate | 49.6% | - |
| Embedding order | 68.0% | < 1 ms |
| Laya choice | 56.0% | 50 ms |

## 3. Temperature and aggregation (for the browser implementation)

Softmax temperature minimising NLL on the 300-video benchmark: area T = 0.015, category T = 0.015.

| Pseudo-course (8 on-topic chunks) | Mean-embedding area | Vote area | Mean cat | Vote cat |
|---|---|---|---|---|
| 0 off-topic chunks | 92.3% | 89.7% | 91.7% | 87.7% |
| 3 off-topic chunks | 90.7% | 88.3% | 89.7% | 87.7% |

## Conclusion

1. Decision rule (Laya must beat embeddings by >= 5 points on area accuracy or precision@1): area -36.7 points, precision@1 -12.0 points -> Laya does NOT qualify; the product uses the embedding method.
2. Zero-shot Laya is far from the embedding centroids on course identification (area 35.3% vs 72.0%), as the model card warns for non-fine-tuned checkpoints. The centroids use ~3000 labeled videos, so the fair zero-shot comparison is the taxonomy-text embedding: 65.3% area vs Laya 35.3%.
3. Category accuracy has the same gap; Laya clamps temperatures for choices with 11+ options (runtime warning), so 16-way area choice is also poorly calibrated.
4. Caveats: labels are LLM-made (a few percent noise); Laya prompts used taxonomy names/descriptions, no prompt tuning; the typed-decisions checkpoint and fine-tuning were not tried.
5. Cost: Laya = 421M-parameter model, ~89 ms per two-step prediction on the RTX 4070 and ~1.4 s on CPU (12-sample timing run), not runnable in the browser; embeddings = ~0.1 ms on data the page already loads.
