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
   be confirmed from the repo. Set them for the **Preview** environment too,
   not just Production, or a preview deploy cannot be smoke-tested.

   These fail SILENTLY-ish rather than loudly, so do not skip this:
   - `ADMIN_KEY` unset → `secretEquals()` returns false for every input, so
     the admin dashboard rejects **every** key and is permanently locked
     out. It looks like a wrong password, not a missing variable.
   - `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` unset → every admin endpoint and
     both `start-run`/`submit-run` return 500. The game's static shell still
     loads, so this reads as "rewards are broken", not "no database".

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
8. **Smoke test the admin dashboard too** (ADR 0017) — it is a second build
   artifact and a separate failure surface from the game:
   - `/admin.html` loads and the gate appears.
   - The real `ADMIN_KEY` unlocks it. A rejection here almost always means
     the variable is missing on this environment, not a wrong key.
   - All five tabs render. Redemptions shows a coupon tail (`••••-XXXX`);
     a column of em dashes means the 2026-08-12 section of
     `supabase/schema.sql` has not been applied yet (step 6).
   - Confirm `https://<deployment>/supabase/schema.sql` returns **404**.
     It used to be published as a public static file; `scripts/build.mjs`
     no longer copies it, and this is the check that it stayed that way.
9. **Record the previous production deployment ID/URL** before promoting —
   this is the rollback target if something breaks.
10. **Get explicit human approval before promoting to production.** No
    exception, regardless of how clean steps 1–9 came back.
