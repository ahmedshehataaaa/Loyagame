/* GET (x-admin-key) ?page=1&pageSize=25 → the anti-cheat feed: runs the
   server flagged as suspicious, newest first.

   Deliberately shaped over PostgREST rather than added as a new RPC. The
   other admin endpoints call RPCs because they aggregate; this one only
   filters and pages a single table, and `supabase/schema.sql` is applied
   BY HAND (see .claude/rules/database-migrations.md) — so keeping this
   migration-free means the Fraud tab works against a database that was
   deployed before this change.

   Pagination is has-more rather than a total count: `sb()` parses the body
   and drops the response headers, so PostgREST's `Content-Range` count is
   not reachable without changing a helper every endpoint shares. Asking for
   one row more than the page is the cheap, local way to answer "is there a
   next page". */
import { sb, ok, bad, isAdmin } from './_lib/db.mjs';

export default async (req) => {
  if (!isAdmin(req)) return bad('unauthorized', 401);
  const params = new URL(req.url).searchParams;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 25));

  try {
    const rows = await sb(
      `/runs?select=id,score,duration_ms,created_at,client_meta,player:players(phone,flags)` +
        `&suspicious=is.true&order=created_at.desc` +
        `&offset=${(page - 1) * pageSize}&limit=${pageSize + 1}`,
    );

    const hasMore = rows.length > pageSize;
    return ok({
      page,
      pageSize,
      hasMore,
      rows: rows.slice(0, pageSize).map((r) => ({
        id: r.id,
        phone: r.player?.phone ?? null,
        score: r.score,
        durationMs: r.duration_ms,
        at: r.created_at,
        // resolve_run() writes {"reason":"resolve_flag"} when it trips any of
        // its checks; older rows predate that and carry null.
        reason: r.client_meta?.reason ?? 'unknown',
        // NOT a per-run review status — no such column exists. This is
        // "the player carries review flags" (players.flags, set by
        // admin-actions' flag_player), which is the closest real signal.
        playerFlagged: Array.isArray(r.player?.flags) && r.player.flags.length > 0,
      })),
    });
  } catch (e) {
    console.error('admin-fraud:', e.message);
    return bad('server_error', 500);
  }
};
