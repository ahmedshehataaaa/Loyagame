# Known traps (2026-08-06)

## A blank red screen doesn't mean the app is broken

If `mcdonalds/` loads as an empty red rectangle with no UI: check that
`server.py` is running the **threaded** version (ADR 0003) and that only
**one** instance is running (`tasklist //FI "IMAGENAME eq python*"` on
Windows). The original single-threaded dev server silently refused ~half
the requests the app fires on load, which made `src/main.js`'s static ES
module imports fail, which threw before the router ever initialized —
zero console message pointed at the real cause. Don't assume a blank
screen means new code broke something; rule out the dev server first.

## Browser-automation timeouts on this machine aren't always the app's fault

This machine's Kaspersky antivirus injects a persistent long-polling script
into every page it loads, which can prevent "network idle" from ever
firing and time out automation tools that wait for it. If a navigation
call times out, take a screenshot / check `list_pages` before concluding
the app crashed — and if a plain external page (e.g. example.com) times
out the same way, it's environment noise, not Slice Rush.

## `.vercel/project.json` is not trustworthy by itself

`mcdonalds/.vercel/project.json` pointed at Krispy Kreme's **live
production** Vercel project (identical `projectId` in both folders) —
almost certainly a copy-paste artifact from when `mcdonalds/` was forked
from `krispy-kreme/`. Detached 2026-08-06 (see ADR 0002). Before any deploy
from any build in this repo's lineage, verify the actual Vercel project
name/ID matches the intended target — don't trust the file at face value.

## Docs in this folder have lied before

Before 2026-08-06, `mcdonalds/DESIGN.md` described **Krispy Kreme**,
`mcdonalds/README.md` described **Pasta Ninja/Slicy-P**, and
`admin.html`'s `<title>` said "Krispy Kreme" — all leftover from the fork,
none updated for the McDonald's build. Corrected this session, but treat
any doc that hasn't been touched recently with the same suspicion: check
it against `engine/config.js` (the actual `BRAND` constant) before trusting
its brand/client claims.

## Two UI layers can both claim to own a screen

`engine/game.js` (canvas HUD) and `src/pages/play.js` (DOM overlay) both
render score/lives during a round — confirmed by screenshot, not just by
reading the code. If a HUD-related bug report doesn't match what you see
in one file, check the other before assuming you're looking at the wrong
line.
