/* GET ?token=<deviceToken> → live profile (points from the ledger-
   backed players table). The game calls this on boot/home so a POS
   credit shows up without replay. */
import { sb, ok, bad, playerByToken } from './_lib/db.mjs';

export default async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  try {
    const player = await playerByToken(token);
    if (!player) return bad('unknown_token', 401);

    sb(`/players?id=eq.${player.id}`, {
      method: 'PATCH', body: { last_seen_at: new Date().toISOString() },
    }).catch(() => {});

    return ok({
      orderPoints: player.order_points,
      highScore: player.high_score,
      games: player.games,
    });
  } catch (e) {
    console.error('profile:', e.message);
    return bad('server_error', 500);
  }
};
