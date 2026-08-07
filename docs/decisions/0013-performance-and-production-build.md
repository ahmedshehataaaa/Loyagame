# 0013 — Purge dead assets, fix the PWA, and add a production build

Date: 2026-08-07
Status: Accepted (Stage 8 of the 2026-08-07 audit)

## Context

Audit findings P1–P7. Measuring first turned up more than the audit had:

**1.19 MB of the 1.79 MB `assets/` directory was unreferenced.** Nine files —
`desktop.jpg`, `results.jpg`, `rotate.jpg`, `tutorial.jpg`, `verify.jpg`,
`loading.jpg`, `locked.jpg`, `gameplay-ref.jpg`, `logo-mark.svg` — were
pre-refactor screen mockups, plus `mascot.png` (the Pasta & Heat rooster,
orphaned by ADR 0010). Nothing loaded them; they shipped anyway.

**The PWA did not exist.** Two independent failures, both silent:

- `sw.js` listed the **pre-refactor** file layout (`./css/style.css`,
  `./js/main.js`, …). `cache.addAll()` rejects **atomically** if any entry
  404s, so the worker never finished installing and nothing was ever cached.
- It was never registered anywhere, so the first failure never even got the
  chance to be noticed. `manifest.webmanifest` promised installability and
  offline play that had never worked.

**Fonts asked for weights nobody used.** The stylesheet requested Sora at
400/600/700/800; only 600 and 800 appear in the CSS. Worse, `--fw-black: 900`
asked for a weight **Sora does not ship**, so browsers synthesised a faux-bold
that renders differently per platform.

**The HUD was driven by a 100 ms `setInterval`.** The engine wrote seven
`data-*` attributes every frame regardless of whether anything changed, and the
DOM layer re-read and rewrote text nodes ten times a second regardless.

**No content hashing and 50 requests on cold load**, ~30 of them individual ES
modules, each a round trip before the next import is even discovered.

## Decision

### Purge, don't optimise, what nothing loads

The nine unreferenced files are deleted (recoverable from tag
`baseline-2026-08-07`). `assets/` 1.79 MB → 600 KB.

### A real service worker, registered

Rewritten with the correct shell, registered after `load` so it never competes
with first paint. Three strategy decisions:

- **Code and markup: network-first**, cache as fallback. With no content
  hashing in the source tree, cache-first serves stale JavaScript indefinitely
  after a deploy — the failure mode where a player is permanently a version
  behind and reloading does not help.
- **Media: cache-first.** Effectively content-addressed already (a new sprite
  gets a new name) and the bulk of the bytes.
- **`/api/*`: never cached.** A cached reward response could show a player a
  prize decision that is not current.

`install` adds shell entries **individually** rather than via `addAll`, so one
moved file costs that file's offline availability instead of the entire worker —
the exact failure being fixed.

### A production build, while keeping the source runnable

This is a deliberate qualification of ADRs 0005/0006, which kept the project
bundler-free. Development still needs no build — `npm run dev` serves the source
directly. But content hashing and request count cannot be fixed without one, so
`npm run build` now emits a hashed, minified `dist/`.

The engine files are **concatenated, not bundled as modules**: they are classic
scripts sharing top-level scope (`game.js` reads `SPECIALS` straight out of
`config.js`'s scope), and treating them as a module graph would break that
silently. `production-build.spec.js` asserts the globals survive.

### Event-driven HUD

The engine diffs its published state and calls `UI.hud()` only when a displayed
value actually changed. Score changes on a slice; the clock once a second. That
turns a per-frame cost into an on-change one and deletes the interval entirely.

### Fonts

Request only the weights used (600, 800). `--fw-black` becomes 800, since Sora
has no 900 and the browser was synthesising it.

## Measured results

4× CPU throttling, 390×844, cold load. Numbers on an unthrottled desktop would
be meaningless for a game targeting an ordinary mid-range phone.

|                        | Source (unbundled) | Built (`dist/`) |
| ---------------------- | ------------------ | --------------- |
| Requests               | 50                 | **13**          |
| Transferred            | 667.3 KB           | **469.0 KB**    |
| — JavaScript           | 207.1 KB           | **92.4 KB**     |
| — CSS                  | 41.9 KB            | 27.0 KB         |
| First contentful paint | 412 ms             | **376 ms**      |
| DOMContentLoaded       | 1134 ms            | **868 ms**      |
| Load event             | 1464 ms            | **1126 ms**     |
| Welcome interactive    | 1736 ms            | **1490 ms**     |

In-round, throttled 4×: **frame delta median 16.7 ms (~59.9 fps), p95 16.8 ms**,
JS heap 10 MB. The p95 sitting on top of the median is the useful part — the
Stage 6 effect budgets mean a busy frame no longer costs materially more than a
quiet one.

`npm run perf` reproduces this.

## Consequences

- `dist/` is gitignored; deployment publishes the build, not the source tree.
- The SW's shell is rewritten by the build to the hashed filenames, so the
  install-time 404 that broke the old worker cannot recur.
- Sourcemaps ship as external files, downloaded only by a developer opening
  devtools.
- Two Playwright web servers now run: the source tree, and `dist/` on 8767.
  The production specs skip themselves with a clear reason when `dist/` is
  absent rather than failing confusingly.

## Two bugs found while doing this

1. **`sourcemap: true` with `write: false` inlines the map as a base64 data
   URI**, which took the shipped bundle from 76 KB to **409 KB**. Now
   `sourcemap: 'external'`. `production-build.spec.js` asserts the bundle
   contains no `sourceMappingURL=data:` and stays under 200 KB.
2. **The performance script reported a flat `0.0 KB` transferred**, because it
   tallied `Content-Length` headers and the dev server does not always send
   them. A measurement that silently reads zero is worse than no measurement;
   it now uses the Resource Timing API's `encodedBodySize`.

## Still open

- **No Lighthouse run.** The score depends on hosting headers (compression,
  cache-control) that this build does not control until it is deployed, so a
  local number would be misleading. Worth doing against a real preview
  deployment.
- **Images are still PNG/JPEG.** WebP/AVIF would cut the remaining 345 KB of
  sprite payload substantially, but re-encoding the client's product artwork is
  an asset-pipeline decision, not a code one.
- **No CI.** Every gate exists as an npm script (`npm run verify`), but nothing
  runs them automatically. There is no repository remote yet either.
