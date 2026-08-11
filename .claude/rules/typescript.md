---
description: TypeScript conventions — currently aspirational, no TS exists in this repo yet
globs: ['**/*.ts', '**/*.tsx']
---

# TypeScript

No `.ts`/`.tsx` files exist anywhere in this repo as of 2026-08-06 — the
entire codebase is vanilla JS (`engine/*.js` classic scripts, `src/*.js`
ES modules, `api/*.mjs`). This rule only activates if/when TypeScript is
actually introduced.

If you're introducing TypeScript for the first time:

- That's an architecture decision, not an incidental choice — write an ADR
  in `docs/decisions/` explaining why (e.g., adopting `packages/
shared-types` from the target structure) and get `lead-architect`
  sign-off first.
- A `package.json` and a production build now exist (ADR 0013), so this is
  less of a leap than it was — but `npm run dev` still serves the source with
  NO compile step, and that is deliberate. Introducing TS would put a build
  between an edit and a reload for the first time. Weigh that explicitly.
- Type checking already runs today via `tsc --checkJs` over JSDoc
  (`npm run typecheck`), with engine globals declared in `types/globals.d.ts`.
  Reach for a JSDoc type before reaching for a `.ts` file.
- Prefer starting TS adoption in a new, isolated `packages/shared-types` or
  similar boundary rather than converting `engine/game.js` in place — don't
  let a "let's try TS" task turn into an accidental rewrite of working
  gameplay code.
- Strict mode on for anything new; don't introduce TS without
  `strict: true` just to move faster initially.
