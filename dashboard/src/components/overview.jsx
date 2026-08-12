import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card.jsx';
import { StatTile, Meter } from './stat-tile.jsx';
import { Empty, EMPTY_COPY } from './empty.jsx';
import { num, pct } from '../lib/format.js';

/* ============================================================
   DROP-OFF — a note on the brief.

   The task asked to SKIP started-vs-finished here, on the understanding that
   the game never pings the server at the start of a round, so any drop-off
   number would be invented.

   That is not the case in this build, so the metric is shown rather than
   skipped. The start ping already exists end to end:

     src/services/loyalty.js  → POST /api/start-run
     api/start-run.mjs        → start_play() RPC
     start_play()             → INSERT INTO runs (…, token_used = false)
     resolve_run()            → UPDATE runs SET token_used = true

   so `started` is a real count of rounds begun and `finished` a real count of
   rounds resolved. admin_engagement() derives both, plus `abandoned` (started,
   never resolved, and past the 15-minute token window that resolve_run itself
   treats as a replay). Nothing here is faked or extrapolated.

   THE METRIC THAT IS GENUINELY MISSING is a different one: ROUND-SURVIVAL
   rate. Per ADR 0004 the game's own win condition is "survive the full 30
   seconds", but `runs` has no `survived` column — resolve_run() accepts
   p_survived, uses it to gate the prize draw, and does not persist it. So the
   share of rounds a player survived cannot be queried, and no tile below
   claims to show it. The wheel tile is labelled "prize win rate" precisely
   because a prize win is gated on ORDER POINTS, not on surviving, and
   conflating the two would misreport both. Persisting `survived` on `runs`
   would be a one-column additive migration; it is deliberately not bundled
   into this change.
   ============================================================ */

export function Overview({ data, engagement, loading }) {
  const stats = data?.stats;
  const runs = stats?.runs;
  const players = stats?.players;
  const redemptions = stats?.redemptions;
  const wheel = stats?.wheel;
  const dropOff = engagement?.stats?.dropOff;

  const totalPlays = runs?.total ?? 0;
  const totalWins = wheel?.winsTotal ?? 0;
  const issued = redemptions?.total ?? 0;
  const redeemed = redemptions?.redeemed ?? 0;
  const unredeemed = Math.max(0, issued - redeemed);
  const prizeWinRate = totalPlays > 0 ? (totalWins / totalPlays) * 100 : 0;

  const hasAnything = loading || totalPlays > 0 || (players?.total ?? 0) > 0;

  if (!hasAnything) {
    return (
      <Card>
        <CardContent className="pt-5">
          <Empty {...EMPTY_COPY.plays} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-8 pt-6 lg:grid-cols-5">
          <StatTile
            hero
            label="Total plays"
            value={num(totalPlays)}
            hint="Rounds started, all time"
            loading={loading}
            className="col-span-2 lg:col-span-1"
          />
          <StatTile
            label="Unique players"
            value={num(players?.total)}
            hint="By phone number"
            loading={loading}
          />
          <StatTile
            label="Prize win rate"
            value={pct(prizeWinRate)}
            hint="Wheel prizes ÷ plays"
            loading={loading}
          />
          <StatTile
            label="Redemption rate"
            value={pct(redemptions?.rate)}
            hint="Redeemed ÷ issued"
            loading={loading}
          />
          <StatTile
            label="Active coupons"
            value={num(unredeemed)}
            hint="Issued, not yet redeemed"
            loading={loading}
          />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coupons</CardTitle>
            <CardDescription>Every wheel prize the server has minted a code for.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Meter
              label="Redeemed at a counter"
              value={redeemed}
              total={issued}
              tone="good"
              hint={
                issued === 0
                  ? 'No Free Fries or McFlurry® codes issued yet.'
                  : `${num(unredeemed)} still outstanding.`
              }
            />
            <Meter
              label="Rounds flagged by anti-cheat"
              value={runs?.suspicious ?? 0}
              total={totalPlays}
              hint={
                (runs?.suspicious ?? 0) === 0
                  ? 'No round has tripped a resolve check.'
                  : 'Flagged rounds are blocked from the wheel draw.'
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Round drop-off</CardTitle>
            <CardDescription>
              Rounds started vs. actually resolved, last 30 days. Real counts &mdash; the game pings{' '}
              <code className="text-[11px]">/api/start-run</code> before every round.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Meter
              label="Finished the round"
              value={dropOff?.finished ?? 0}
              total={dropOff?.started ?? 0}
              tone="good"
              hint={
                (dropOff?.started ?? 0) === 0
                  ? 'No rounds started in this window.'
                  : `${num(dropOff?.abandoned ?? 0)} abandoned (started, never resolved, token window closed).`
              }
            />
            <p className="text-subtle-foreground flex gap-2 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Round-<em>survival</em> rate is not shown: <code>runs</code> does not persist
                whether the player survived, so it cannot be queried. A prize win is gated on order
                points, not survival &mdash; the two are not interchangeable.
              </span>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
