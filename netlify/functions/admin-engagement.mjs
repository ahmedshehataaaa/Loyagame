/* GET (x-admin-key) ?days=14 -> plays/day, score distribution, peak
   play hour-of-day, and drop-off (started vs. actually finished). */
import { rpc, ok, bad, isAdmin } from './_lib/db.mjs';

export default async (req) => {
  if (!isAdmin(req)) return bad('unauthorized', 401);
  const params = new URL(req.url).searchParams;
  const days = Math.min(90, Math.max(1, Number(params.get('days')) || 14));

  try {
    const stats = await rpc('admin_engagement', { p_days: days });
    return ok({ days, stats });
  } catch (e) {
    console.error('admin-engagement:', e.message);
    return bad('server_error', 500);
  }
};
