# Runbook: pre-deploy checklist

Operational companion to `claimlabs-release`/`release-manager` — run this
literally, in order, every time, not from memory.

1. **Vercel project identity** — `vercel link` (interactively) or check
   via the Vercel MCP `get_project` tool. Confirm the `projectName` matches
   the intended target before proceeding. Do not deploy if
   `.vercel.krispy-kreme-link.bak` is the only link artifact present —
   that means this folder is currently **unlinked** (ADR 0002) and needs a
   fresh, correct link first.
2. **Environment variables present on the target deployment**:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_KEY`,
   `FOODICS_WEBHOOK_SECRET`. Check the Vercel dashboard directly — cannot
   be confirmed from the repo.
3. **Syntax/parse check every changed file**:
   ```
   node --check <file>.js         # for each changed .js/.mjs
   ```
   (Automated on every edit via `.claude/hooks/post-edit-check.js`, but
   re-run explicitly across the full diff before a release, not just
   file-by-file during development.)
4. **Boot the app locally and confirm zero console errors** — see
   `local-dev-setup.md`. Rule out the dev-server threading issue before
   treating any boot failure as a real regression.
5. **If `WHEEL` or `resolve_run` changed**: confirm
   `docs/security/reward-wheel-compliance.md` has been explicitly
   addressed for this release (resolved, or knowingly deferred with
   sign-off recorded) — do not deploy a reward-model change silently past
   this flag.
6. **If `supabase/schema.sql` changed**: apply it manually against the
   target Supabase project (staging first) — there is no migration runner.
   Confirm additive/backward-compatible, or document the required
   deploy-then-migrate ordering explicitly.
7. **Smoke test the preview deployment**: boots, a full round can be
   played, `submit-run` round-trips with a real response. Attach evidence
   (screenshot + response body), not a description.
8. **Record the previous production deployment ID/URL** before promoting —
   this is the rollback target if something breaks.
9. **Get explicit human approval before promoting to production.** No
   exception, regardless of how clean steps 1–8 came back.
