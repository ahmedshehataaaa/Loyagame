---
name: claimlabs-stitch-to-code
description: Use when implementing a Slice Rush screen from a Stitch design — finding the right Stitch project/screens, reading design structure, extracting tokens, building reusable components, responsive implementation, and comparing the result against the design. Use to avoid giant unstructured generated files.
---

# ClaimLabs Stitch → code workflow

## Current Stitch connector status

As of 2026-08-06, the `stitch` MCP server connects but its tool-fetch has
been failing ("can't resolve reference #/$defs/ScreenInstance"). Don't
assume live Stitch MCP access works — check first
(`mcp__stitch__list_projects` or equivalent), and fall back to the
**already-extracted** design reference at `mcdonalds/stitch-export/` if the
live connector isn't working.

## What's already extracted (use this before re-fetching)

`mcdonalds/stitch-export/` contains, per screen: `reference.png` (visual)
and `source.html` (structure) for **victory, gameplay, asset-library,
leaderboard, welcome**. `src/styles/tokens.css`'s header comment names the
source Stitch project explicitly: **"McSlice Rewards Arcade"**
(`11798987857471355483`) — use that project if re-fetching from Stitch
directly, don't search blind.

## Procedure

1. **Check `stitch-export/` first.** If the screen you need already has a
   `reference.png`/`source.html` pair, start there — it's a known-good
   snapshot, not a live-connector gamble.
2. **If Stitch MCP is needed and not working**, say so explicitly rather
   than silently falling back — the human may want to fix the connector
   (see `docs/project-inventory.md` / MCP status) before you proceed from a
   possibly-stale export.
3. **Extract tokens into `src/styles/tokens.css`**, not inline styles —
   this file is already the real, current source of truth for color/type/
   spacing/shadow tokens (see its own header comment). Extend it, don't
   duplicate it.
4. **Build reusable components in `src/components/ui.js`**, matching its
   existing patterns (`el`, `button`, `tabbar`, etc. — check current
   exports before inventing new primitives).
5. **Responsive**: canonical mobile frame per the inherited `DESIGN.md` is
   390×844 — check 375×667, 393×852, 430×932, then tablet/desktop
   scale-up (desktop always shows the mobile-gate; scaling matters for the
   phone-bezel demo view, not real desktop use).
6. **Compare implementation against the design** — screenshot the built
   screen next to `reference.png` at the same viewport width before calling
   it done. A visual diff is the actual acceptance test here, not "the
   HTML structure looks similar."
7. **Avoid giant unstructured files.** `source.html` exports from Stitch
   are reference material, not something to copy wholesale into `src/` —
   translate structure into the existing component patterns, don't paste a
   3000-line generated file into a page module.

## Red flags to stop and ask about

- A Stitch screen implies gameplay-logic changes (not just visuals) — that
  crosses into `gameplay-engineer` territory, not a pure UI task.
- A Stitch screen's copy/branding doesn't match `engine/config.js`'s
  `BRAND` constant — confirm which is current before implementing either.
