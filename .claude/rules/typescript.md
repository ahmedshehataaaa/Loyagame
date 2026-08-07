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
- It requires a `package.json` and a build step to exist, which currently
  don't — that's a bigger change than it looks, since `engine/`'s
  global-script loading pattern and `src/`'s no-bundler ES modules both
  currently work specifically _because_ there's no compile step. Adding
  TS changes that constraint for the whole project, not just the new file.
- Prefer starting TS adoption in a new, isolated `packages/shared-types` or
  similar boundary rather than converting `engine/game.js` in place — don't
  let a "let's try TS" task turn into an accidental rewrite of working
  gameplay code.
- Strict mode on for anything new; don't introduce TS without
  `strict: true` just to move faster initially.
