# Runbook: local dev setup

## Start the server

```bash
cd mcdonalds
python3 server.py          # http://localhost:8765
```

`server.py` uses a threaded static server as of ADR 0003 — confirm you're
not running an older copy if this was checked out before 2026-08-06
(`grep ThreadingMixIn server.py` should find a match).

## Before starting: check for stray instances

Python's `allow_reuse_address` does not mean two instances can share the
port cleanly. A second stray process causes intermittent, confusing
`ERR_CONNECTION_REFUSED` errors that look like app bugs.

```bash
# Windows
tasklist //FI "IMAGENAME eq python*"
taskkill //F //IM python3.exe   # if a stray one is found
```

## Load the game

```
http://localhost:8765/?play&dev&anyday
```
- `?play` — bypass the mobile/tablet-only gate (for desktop testing)
- `?dev` — enable dev helpers
- `?anyday` — bypass any day-of-week gating inherited from prior loyalty
  models in this lineage

## If the page loads blank / red with no UI

1. Confirm the server is the threaded version and only one instance is
   running (above).
2. Check the browser console/network tab for `ERR_CONNECTION_REFUSED` on
   any of the ~17 requests the app fires on load (CSS, JS modules, item
   sprites). If present with the *old* single-threaded server, that's ADR
   0003's bug — restart with the fixed `server.py`.
3. If requests all succeed (200) but the screen is still blank, this is a
   real app bug, not the known server issue — start
   `claimlabs-debugging`'s workflow.

## If browser automation tools time out / report "frame detached"

This machine's antivirus (Kaspersky, confirmed 2026-08-06) injects a
persistent long-polling script into every page, which can prevent
"network idle" from firing and time out tools that wait for it. Sanity
check: does a plain external page (e.g. `http://example.com`) also hang
the same way? If yes, it's environment noise — take a screenshot / check
`list_pages` directly instead of relying on the navigation call's own
success signal. If no, the timeout is specific to this app — investigate
for real (see the ADR 0003 case study in `claimlabs-debugging`).

## Backend/API testing locally

`server.py` serves static files only — it does **not** execute
`api/*.mjs` as real serverless functions. A `fetch('/api/...')` from the
client against this local server will get the raw `.mjs` source text or a
404, not a real function response. To test backend endpoints locally, use
`vercel dev` (if the project is properly linked — see ADR 0002) or call
the deployed preview's `/api/*` routes directly.
