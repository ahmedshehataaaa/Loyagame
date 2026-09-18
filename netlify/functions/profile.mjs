/* GET ?token=<deviceToken> → live profile (points from the ledger-
   backed players table). The game calls this on boot/home so a POS
   credit shows up without replay.
   Scoped to the tenant named by X-Tenant. Not gated on a live tenant:
   a paused campaign's players can still see the balance they earned. */
import { sb, ok, bad, playerByToken, tenantContext, dbFailure } from './_lib/db.mjs';
import { webHandler } from './_lib/http.mjs';

const handler = async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  try {
    const { ctx, error } = await tenantContext(req);
    if (error) return error;

    const player = await playerByToken(token, ctx);
    if (!player) return bad('unknown_token', 401);

    sb(
      `/players?id=eq.${player.id}`,
      { method: 'PATCH', body: { last_seen_at: new Date().toISOString() } },
      ctx,
    ).catch(() => {});

    return ok({
      orderPoints: player.order_points,
      highScore: player.high_score,
      games: player.games,
    });
  } catch (e) {
    return dbFailure('profile', e);
  }
};

export default webHandler(handler);
