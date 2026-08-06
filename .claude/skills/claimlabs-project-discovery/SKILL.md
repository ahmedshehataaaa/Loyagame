---
name: claimlabs-project-discovery
description: Use when locating, comparing, or identifying the source-of-truth build among Slice Rush's multiple builds/lineages, or when a request references "the game" ambiguously and it's unclear which folder it means.
---

# ClaimLabs project discovery

## Why this exists

This repository's parent directory (`Desktop/first project/`) contains at
least five related builds sharing a common engine ancestry, with
near-identical filenames and, in places, stale docs claiming the wrong
client. Guessing which one a request means, or trusting a README's
self-description, has already caused real confusion once (see
`docs/project-inventory.md`). Don't repeat that.

## Procedure

1. **Confirm the target build explicitly** if a request doesn't name one.
   Default assumption: `mcdonalds/` (the confirmed source of truth as of
   2026-08-06) — but say so out loud rather than silently assuming, since
   the parent folder has real siblings a request might actually mean.
2. **Don't trust a file's own claims about itself.** Check
   `engine/config.js`'s `BRAND.name` and `FOODS` roster against what a
   README/DESIGN doc says — they have disagreed before.
3. **Use filesystem mtimes, not Git history**, to establish recency — no
   Git repository exists in this project as of 2026-08-06.
   ```
   find "<folder>" -type f -printf '%T@ %p\n' | sort -rn | head -20
   ```
4. **Check `docs/project-inventory.md` first** — it's the maintained,
   evidence-based record of what was found, where, and why `mcdonalds/`
   was chosen. Update it (don't create a competing doc) if discovery work
   turns up something new.
5. **When comparing two versions of the same feature** across builds,
   diff the actual constants (`ROUND_TIME`, `START_LIVES`, `WHEEL.*`) —
   don't assume two builds with the same engine ancestry share current
   values; they've already diverged (60s/3-lives in `krispy-kreme`/
   `fastfood-ninja` vs. 30s/2-lives in `mcdonalds` as of ADR 0001).

## Delegate to `repository-cartographer`

For anything beyond a quick lookup — "where is X handled," "does Y exist
anywhere in this lineage," dependency mapping — dispatch the
`repository-cartographer` agent rather than doing an ad hoc multi-folder
grep yourself. It's read-only and scoped exactly for this.
