# PortfolioIQ — working notes

Read this before changing anything.

## Build

`index.html` is **generated**. Never edit it directly — your change will be overwritten.

```bash
py tools/prepare_data.py     # source workbook -> data/*.csv|xlsx|json  (only if the dataset changes)
py tools/build_app.py        # src/index.template.html + fonts + data -> index.html
node tools/smoke_test.js     # 28 assertions; must pass before committing
```

Edit `src/index.template.html`, then rebuild. The build injects `src/fonts.css` at `/*__FONTS__*/`
and `data/portfolio.json` at `/*__DATA__*/`.

## Constraints — do not break these

- **Single file, zero dependencies.** No CDN, no npm, no build tooling beyond the two scripts above.
  `index.html` must open from the filesystem with no network access. XLSX parsing uses the native
  `DecompressionStream`; do not add SheetJS.
- **Deterministic.** All inference is seeded via `rngFrom(assetId + '|purpose')`. Never use
  `Math.random()` — the smoke test asserts identical output across reruns, and a demo that changes
  its numbers between refreshes is not defensible.
- **Guardrails are hard rules.** A Mission Critical, revenue-bearing, regulated-with-critical-
  dependants, or blast-radius-≥12 asset can never be assigned Retire. Three separate smoke-test
  assertions cover this. If a change makes them fail, the change is wrong.
- **The dependency graph must stay acyclic.** Dependencies may only point to a strictly lower
  `LAYER` rank. This was a real bug: cycles made every asset transitively reach every other, blast
  radius degenerated to 600, and the blast-radius guardrail silently stopped discriminating.
- **Inferred values must be labelled as inferred** in the UI. The credibility of the whole tool rests
  on not passing heuristics off as facts.

## Where things live in the template

| Section | Contents |
|---|---|
| 1 | `VENDORS` pack, `CAT_PROFILE`, `LAYER`, `PREFERS` — the knowledge base |
| 2 | `ALIASES`, `mapColumns`, `ingest` — column mapping |
| 3 | `infer()` — primitives, risk, dependency graph, scores, redundancy, disposition, savings |
| 4 | `buildScenario()` — the optimiser |
| 5 | `hbar` / `waterfall` / `scatter` / `donut` — hand-rolled SVG, no chart library |
| 6 | `vExec` … `vData` — one function per tab, returns an HTML string |
| 7 | `openAsset()` — the drawer |
| 8 | `wire()` — event binding, re-run after every render |
| 9 | `parseCSV` / `parseXLSX` / `unzip` — file ingest |

## Tuning

Savings ratios are planning assumptions and live in one place (section 3e): Retire 100%,
Consolidate 86%, Replace 28%, idle-seat reclamation 60%. Scoring weights are in 3c. Change these
deliberately and update `docs/METHODOLOGY.md` in the same commit — the doc states exact numbers and
a drifted doc is worse than none.

## Style

Aberdeen brand: navy `#09375F`, verdigris `#44B0B1`, Poppins. Sentence case in UI copy. British
spelling in prose ("utilisation", "licences") — the source data uses American ("Licenses"), so keep
column names exactly as they appear in the file.
