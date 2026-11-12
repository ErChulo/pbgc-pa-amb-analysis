# §21 acceptance thresholds (Stage 7, 2026-11-12)

Set from the measured baselines in
`stage7/05-benchmarks-open-items.md` §1. Baseline for each cell is
the **slower of the Node and browser engine-direct measurements**;
headroom is ~2–3× at 100–10,000 and ~1.3–1.9× at 100,000, where
the current implementation is already near the edge of what a
browser tab tolerates. Machine: Linux VM, Node v24.22.1, Chromium
158 headless, 1.5 shared CPUs, ~6 GB RAM — re-measure on the
office workstation (Edge) when it is available; these thresholds
must hold in both engines. The 35.2 ms table render from Stage 6
is a baseline, not a threshold.

## Engine-direct thresholds (both engines)

| Metric | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|
| Import | 25 ms | 150 ms | 1,500 ms | 10,000 ms |
| Validation | 100 ms | 750 ms | 10,000 ms | 30,000 ms |
| Calculation | 200 ms | 1,500 ms | 10,000 ms | 60,000 ms |
| Reconciliation | 25 ms | 100 ms | 500 ms | 5,000 ms |
| Statistical analysis | 150 ms | 250 ms | 2,000 ms | 20,000 ms |
| Model fit | 25 ms | 50 ms | 250 ms | 2,000 ms |
| Report CSV | 10 ms | 25 ms | 100 ms | 1,000 ms |
| Report XLSX | 50 ms | 250 ms | 1,500 ms | 20,000 ms |
| Report HTML | 25 ms | 25 ms | 100 ms | 5,000 ms |
| Incremental recalculation | 50 ms | 250 ms | 2,000 ms | 15,000 ms |
| End-to-end wall | 500 ms | 3,000 ms | 30,000 ms | 360,000 ms (6 min) |
| Peak JS heap | 50 MB | 100 MB | 500 MB | 3,000 MB |

**Current build status (engine-direct).** Passes every cell in both
engines at all sizes (Stage 7 fix pass, 2026-11-12). 100k validation:
Node 18.1 s, browser 11.8 s — the P-16 Map-indexed fix
(`src/validation.ts`) replaced the O(n²) pairwise scan (Node never
finished, browser 211 s). The 100k validation threshold was
tightened from 300 s to 30 s after the fix, as this file required.
Note: the Node 100k probe needs `--max-old-space-size=4096` — the
default 2 GB heap OOMs (100k validation holds 6.6M rule evaluations
and 2.16M findings; heap 2,621 MB, inside the 3,000 MB peak-heap
threshold). Browser 100k: wall 71.3 s, heap peak 2,297 MB.

## UI-path thresholds (what the human experiences, through the shipped app)

| Step | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|
| Validate | 250 ms | 1,000 ms | 5,000 ms | 60,000 ms |
| Calculate | 500 ms | 5,000 ms | 30,000 ms | 120,000 ms |
| Reconcile | 750 ms | 20,000 ms | 60,000 ms | 300,000 ms |
| Review statistics | 250 ms | 2,000 ms | 10,000 ms | 60,000 ms |
| Wall | 2,000 ms | 30,000 ms | 120,000 ms | 600,000 ms |

**Current build status (UI path).** 100: passes all. 1,000:
passes all (wall 1.1 s). 10,000: **passes all** (Stage 7 fix pass,
2026-11-12 — validate 1.1 s, calculate 3.8 s, reconcile 0.8 s,
statistics 2.7 s, wall 9.0 s; the batched-dispatch fix,
`src/ui/state.ts` applyBatch + `dispatchMany`, replaced the
per-dispatch spread + full re-render that had projected reconcile
≥560 s and wall ≥580 s). 100,000: **not run** (the UI path at
100,000 is still projected, not measured; validation no longer
blocks it, but the run itself has not been done).
