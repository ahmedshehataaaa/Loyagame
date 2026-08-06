---
name: claimlabs-backend-api
description: Project-specific conventions for Slice Rush's backend (Node.js Vercel Functions + Netlify mirror) — validation, auth, error handling, logging, transactions, pagination, webhooks, idempotency, testing. Use for any api/*.mjs or netlify/functions/ work.
---

# ClaimLabs backend API conventions

## Stack (as actually used, not a generic Node.js guide)

Plain Node.js **Vercel Functions** (`.mjs`, no framework — see
`api/*.mjs`), mirrored by hand under `netlify/functions/` for dual-host
support (`netlify.toml` rewrites `/api/*` → `/.netlify/functions/*`).
**No Express, no ORM.** Supabase Postgres accessed via raw `fetch` to
PostgREST (`lib/db.mjs`'s `sb()`/`rpc()`). No `package.json`, so no npm
dependencies — any new backend code must stay dependency-free or this
constraint needs a deliberate, documented decision to change.

## Conventions already established — follow them, don't invent new ones

- **Response helpers**: `ok(obj)` / `bad(error, status)` from `lib/db.mjs` —
  use these, don't hand-roll `new Response(...)` in a new endpoint.
- **Body parsing**: `readBody(req)` (wraps `req.json()`, returns `null` on
  parse failure — check for `null`, not a thrown exception).
- **Method guard**: every handler starts with
  `if (req.method !== 'POST') return bad('method_not_allowed', 405);` —
  match this even for endpoints that might later need GET.
- **Auth**: `isAdmin(req)` / `isPosCaller(req)` — constant-time secret
  comparison via `secretEquals`. Any new privileged endpoint uses one of
  these, not a new ad hoc check.
- **Validation**: manual, inline, fail-fast (`if (!body) return
  bad('bad_json')`, `if (!Number.isFinite(score) || score < 0) return
  bad('invalid_score')`) — no schema library. Keep this pattern for
  consistency unless a validation library is a deliberate, documented
  addition (it would need a `package.json` to exist first).
- **Business logic in RPCs, not in the handler**: handlers are thin —
  they validate input, call an `rpc()`, shape the response. The actual
  decision logic (row locking, plausibility checks, prize selection) lives
  in `supabase/schema.sql`. Keep new endpoints this shape; don't move
  transactional logic into JS where it loses the database's locking
  guarantees.
- **Errors are logged server-side, not leaked to the client**: `catch (e)
  { console.error('label:', e.message); return bad('server_error', 500);
  }` — match this, don't return `e.message` or a stack trace in the
  response body.

## Dual-host mirror discipline

`api/*.mjs` and `netlify/functions/*.mjs` must stay behaviorally identical.
If you change one, check the other exists and update it too — they were
observed to already exist as parallel copies; nothing currently generates
one from the other, so drift is a real risk, not a hypothetical.

## Idempotency

Any endpoint triggered by an external system (POS/Foodics webhooks) must be
safely retriable — use a unique constraint on the natural idempotency key
(order ID, transaction ID), matching `points_ledger_order_uniq`. Any
endpoint that issues a one-time resource (a run token, a reward code) must
mark it consumed inside the same transaction that uses it, matching
`resolve_run`'s `token_used` pattern.

## Testing

No test suite exists for any endpoint yet. Until `claimlabs-testing` is
acted on, verify a new/changed endpoint with a real `curl` against the
local dev server (or the deployed preview) and paste the actual
request/response — not a description of expected behavior.
