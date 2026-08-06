---
description: Rules for docs, ADRs, and CLAUDE.md itself
globs: ["docs/**", "*.md", "CLAUDE.md", "REVIEW.md", ".claude/**/*.md"]
---

# Documentation

- **Docs in this repo have a documented history of being wrong for the
  actual folder they're in** — before 2026-08-06, `mcdonalds/DESIGN.md`
  described Krispy Kreme and `mcdonalds/README.md` described the original
  Pasta Ninja build, both copy-paste leftovers from the fork. Don't add a
  new doc without checking it actually describes *this* build, not an
  inherited one.
- **Architecture changes get an ADR** in `docs/decisions/` (see the
  numbered `000N-*.md` pattern already established) — not just a
  changed comment somewhere. Follow the existing ADR shape: Context,
  Decision, Consequences (and Verification, where something was actually
  run to confirm the change worked).
- **Open, unresolved issues live under `docs/security/` or as flagged
  sections in relevant skills/agent files** — not silently fixed via a doc
  edit that asserts they're resolved. `docs/security/reward-wheel-
  compliance.md` is the standing example: it stays open until an actual
  legal/business decision is recorded, not until someone gets tired of
  seeing the flag.
- **`docs/project-inventory.md` is the maintained source of truth for
  "what exists and where."** Update it when discovery work changes what's
  known — don't create a second, competing inventory doc.
- **Keep `CLAUDE.md` concise.** Detailed workflows belong in
  `.claude/skills/`, not inlined into the root file — if `CLAUDE.md` is
  growing past what a session needs to orient itself, that content
  probably belongs in a skill instead.
