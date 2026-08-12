-- ============================================================
-- Slicy-P loyalty backend — Supabase schema (run once in the
-- Supabase SQL editor). Server-authoritative version of the
-- localStorage model in js/data.js:
--   • points come ONLY from ordering (POS credits the ledger)
--   • playing is free training; every run is logged for stats
--   • play-to-win: reaching wheel_points_threshold ORDER-POINTS unlocks
--     a spin, and spinning SPENDS those points (repeatable earn/spend loop);
--     no competition, no leaderboard (removed July 2026)
-- Identity is an UNVERIFIED phone number (user decision July 2026)
-- — multi-device claims are flagged for review, never blocked.
--
-- Access model: RLS is ENABLED with no anon policies, so the
-- anon/public key can read NOTHING. Only the service-role key
-- (used by the Netlify Functions) can touch these tables.
-- ============================================================

create extension if not exists pgcrypto;

-- ---- players ------------------------------------------------
create table if not exists players (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null unique,          -- E.164, the identity key
  country_code  text,
  consent       boolean not null default false,
  order_points  integer not null default 0,    -- cache; ledger is the truth
  high_score    integer not null default 0,
  games         integer not null default 0,    -- total runs played
  device_token  uuid not null default gen_random_uuid(),
  flags         jsonb not null default '[]',   -- [{type,at,note}] fraud/review flags
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- ---- points ledger (auditable source of truth for points) ---
create table if not exists points_ledger (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references players(id) on delete cascade,
  delta      integer not null,
  reason     text not null check (reason in ('order','admin','adjust')),
  order_id   text,                             -- POS order id (idempotency key)
  source     text not null default 'manual' check (source in ('foodics','manual','demo')),
  note       text,
  created_at timestamptz not null default now()
);
create unique index if not exists points_ledger_order_uniq
  on points_ledger (order_id) where order_id is not null;
create index if not exists points_ledger_player_idx on points_ledger (player_id, created_at desc);

-- The order's real EGP value, captured so the client dashboard can report
-- revenue / AOV (points alone can't — they're a function of points_per_egp).
-- Null for legacy rows and for manual point-only credits with no amount.
alter table points_ledger add column if not exists amount_egp numeric;
create index if not exists points_ledger_order_rev_idx
  on points_ledger (created_at) where reason = 'order';

-- Allow the wheel-spend debit reason (July 2026: wheel unlock is gated on
-- real order-points, and a spin spends them). Idempotent: drop + re-add so
-- re-running this file safely widens the constraint on an existing instance.
alter table points_ledger drop constraint if exists points_ledger_reason_check;
alter table points_ledger add constraint points_ledger_reason_check
  check (reason in ('order','admin','adjust','wheel_spend'));

-- Keep players.order_points in sync with the ledger.
create or replace function apply_ledger_delta() returns trigger language plpgsql as $$
begin
  update players
     set order_points = greatest(0, order_points + new.delta)
   where id = new.player_id;
  return new;
end $$;
drop trigger if exists points_ledger_apply on points_ledger;
create trigger points_ledger_apply after insert on points_ledger
  for each row execute function apply_ledger_delta();

-- ---- runs (every play; row doubles as a round token) --------
create table if not exists runs (
  id             bigint generated always as identity primary key,
  player_id      uuid not null references players(id) on delete cascade,
  score          integer not null,
  month_key      text not null,                -- 'YYYY-MM'
  duration_ms    integer,
  client_meta    jsonb,
  suspicious     boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists runs_month_idx on runs (month_key);
create index if not exists runs_player_idx on runs (player_id, created_at desc);

-- ---- settings (tunables without redeploy) ---------------------
create table if not exists settings (
  key   text primary key,
  value jsonb not null
);
-- Authoritative play-to-win config lives here (NOT trusted from the
-- client). `wheel_prizes` is ASCII-only on purpose — emoji glyphs are
-- added client-side by matching `key`, so a clipboard paste can't mangle
-- them. Keys/labels/weights must mirror CONFIG.WHEEL.prizes in config.js.
-- `do update` so re-running this file re-applies the pivot defaults.
insert into settings (key, value) values
  ('points_per_egp',      '1'),
  ('max_plausible_score', '2000000'),   -- anti-cheat score ceiling (score no longer gates the wheel)
  ('min_run_ms',          '5000'),
  ('max_runs_per_hour',   '40'),
  ('wheel_points_threshold', '4000'),   -- ORDER-POINTS needed to spin (a spin spends this)
  ('max_plays',           '999999'),
  ('play_window_hrs',     '24'),
  ('win_lockout_hrs',     '12'),
  ('commission_pct',      '0'),         -- client's earnings rate on reward-driven revenue; 0 hides the card
  ('currency',            '"EGP"'),
  ('wheel_prizes', '[
    {"key":"off5","label":"5% off a dozen","weight":28},
    {"key":"glazed","label":"Free Original Glazed","weight":20},
    {"key":"off10","label":"10% off a dozen","weight":18},
    {"key":"coffee","label":"Free coffee","weight":12},
    {"key":"kreme","label":"Free Kreme Filled","weight":9},
    {"key":"off15","label":"15% off a dozen","weight":6},
    {"key":"half","label":"Free half-dozen","weight":4},
    {"key":"off20","label":"20% off a dozen","weight":2},
    {"key":"dozen","label":"Free dozen","weight":0.8},
    {"key":"off25","label":"25% off a dozen","weight":0.2}
  ]')
on conflict (key) do update set value = excluded.value;

-- ---- atomic RPCs (called by Netlify Functions via /rpc) --------

-- Idempotent order-points credit, keyed to phone. Creates a stub
-- player if the phone has never opened the game, so points wait
-- for them when they do. p_amount_egp is the order's real value,
-- stored for revenue reporting (null when only points are known).
drop function if exists credit_order_points(text, text, integer, text, text);
create or replace function credit_order_points(
  p_phone text, p_order_id text, p_points integer, p_source text default 'manual',
  p_note text default null, p_amount_egp numeric default null
) returns table (player_id uuid, new_balance integer, duplicate boolean)
language plpgsql as $$
declare v_player uuid;
begin
  if p_order_id is not null and exists (select 1 from points_ledger l where l.order_id = p_order_id) then
    select pl.id, pl.order_points into v_player, new_balance
      from points_ledger l join players pl on pl.id = l.player_id
     where l.order_id = p_order_id limit 1;
    player_id := v_player; duplicate := true;
    return next; return;
  end if;

  insert into players (phone) values (p_phone)
  on conflict (phone) do update set last_seen_at = now()
  returning id into v_player;

  insert into points_ledger (player_id, delta, reason, order_id, source, note, amount_egp)
  values (v_player, p_points, 'order', p_order_id, p_source, p_note, p_amount_egp);

  select pl.order_points into new_balance from players pl where pl.id = v_player;
  player_id := v_player; duplicate := false;
  return next;
end $$;

-- Everything the admin dashboard shows, in one call.
create or replace function admin_dashboard(
  p_month text default null,
  p_lockout integer default 12, p_maxplays integer default 5)
returns jsonb language plpgsql as $$
declare mk text;
begin
  mk := coalesce(p_month, to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM'));
  return jsonb_build_object(
    'monthKey', mk,
    'players', jsonb_build_object(
      'total',     (select count(*) from players),
      'new7d',     (select count(*) from players where created_at > now() - interval '7 days'),
      'flagged',   (select count(*) from players where jsonb_array_length(flags) > 0)
    ),
    'points', jsonb_build_object(
      'issued',    coalesce((select sum(delta)  from points_ledger where delta > 0), 0),
      'deducted',  coalesce((select -sum(delta) from points_ledger where delta < 0), 0),
      'liability', coalesce((select sum(order_points) from players), 0)
    ),
    'runs', jsonb_build_object(
      'total',      (select count(*) from runs),
      'last24h',    (select count(*) from runs where created_at > now() - interval '24 hours'),
      'month',      (select count(*) from runs where month_key = mk),
      'avgScore',   coalesce((select round(avg(score)) from runs where month_key = mk), 0),
      'suspicious', (select count(*) from runs where suspicious)
    ),
    'wheel', jsonb_build_object(
      'winsTotal',  (select count(*) from wheel_wins),
      'wins24h',    (select count(*) from wheel_wins where created_at > now() - interval '24 hours'),
      'winsMonth',  (select count(*) from wheel_wins
                       where to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM') = mk),
      'byPrize',    coalesce((select jsonb_agg(jsonb_build_object('prize', t.prize_label, 'n', t.n)
                                order by t.n desc)
                      from (select prize_label, count(*) n from wheel_wins
                            where to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM') = mk
                            group by prize_label) t), '[]'::jsonb),
      'recent',     coalesce((select jsonb_agg(jsonb_build_object(
                        'phone', p2.phone, 'prize', w.prize_label, 'score', w.score, 'at', w.created_at)
                        order by w.created_at desc)
                      from (select * from wheel_wins order by created_at desc limit 15) w
                      join players p2 on p2.id = w.player_id), '[]'::jsonb)
    ),
    'plays', jsonb_build_object(
      'lockedNow',  (select count(distinct w.player_id) from wheel_wins w
                       where w.created_at > now() - make_interval(hours => p_lockout)),
      'cappedToday',(select count(*) from (
                       select r.player_id from runs r
                        where r.created_at > now() - interval '24 hours'
                        group by r.player_id having count(*) >= p_maxplays) c)
    ),
    'redemptions', jsonb_build_object(
      'total',    (select count(*) from wheel_wins),
      'redeemed', (select count(*) from wheel_wins where redeemed),
      'rate',     case when (select count(*) from wheel_wins) = 0 then 0
                    else round((select count(*) from wheel_wins where redeemed)::numeric
                               / (select count(*) from wheel_wins) * 100, 1) end
    ),
    'pointsFunnel', coalesce((select jsonb_agg(jsonb_build_object('bucket', b.label, 'n', b.n) order by b.ord)
                     from (
                       select '0-200' as label, 1 as ord, count(*) as n from players where order_points >= 0   and order_points < 200
                       union all
                       select '200-450', 2, count(*) from players where order_points >= 200 and order_points < 450
                       union all
                       select '450-650', 3, count(*) from players where order_points >= 450 and order_points < 650
                       union all
                       select '650+',    4, count(*) from players where order_points >= 650
                     ) b), '[]'::jsonb),
    'topHolders', coalesce((select jsonb_agg(jsonb_build_object(
                      'phone', t.phone, 'points', t.order_points) order by t.order_points desc)
                    from (select phone, order_points from players
                          where order_points > 0 order by order_points desc limit 10) t), '[]'::jsonb),
    'recentSignups', coalesce((select jsonb_agg(jsonb_build_object(
                        'phone', t.phone, 'at', t.created_at, 'points', t.order_points) order by t.created_at desc)
                      from (select phone, created_at, order_points from players
                            order by created_at desc limit 10) t), '[]'::jsonb),
    'flaggedPlayers', coalesce((select jsonb_agg(jsonb_build_object(
                         'phone', t.phone, 'flags', t.flags, 'points', t.order_points))
                       from (select phone, flags, order_points from players
                             where jsonb_array_length(flags) > 0 limit 20) t), '[]'::jsonb),
    'suspiciousRuns', coalesce((select jsonb_agg(jsonb_build_object(
                         'phone', p2.phone, 'score', r.score, 'at', r.created_at,
                         'meta', r.client_meta) order by r.created_at desc)
                       from (select * from runs where suspicious order by created_at desc limit 20) r
                       join players p2 on p2.id = r.player_id), '[]'::jsonb),
    'scoreDist', coalesce((select jsonb_agg(jsonb_build_object('bucket', t.bucket, 'n', t.n) order by t.bucket)
                   from (select (score / 1000) * 1000 as bucket, count(*) as n
                         from runs where month_key = mk group by 1) t), '[]'::jsonb),
    'runsPerDay', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'n', t.n) order by t.day)
                    from (select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day, count(*) as n
                          from runs where created_at > now() - interval '14 days' group by 1) t), '[]'::jsonb)
  );
end $$;

-- ============================================================
-- PLAY-TO-WIN PIVOT (July 2026): spin-the-wheel + tight play
-- limits, no competition. Safe to re-run (idempotent). Limits are
-- enforced by phone OR device so clearing one doesn't reset them.
-- ============================================================

-- runs double as round tokens: start_play inserts a row (counts the
-- play) with an unused token; resolve_run consumes it with the score.
alter table runs    add column if not exists token uuid;
alter table runs    add column if not exists token_used boolean not null default false;
alter table runs    add column if not exists device_id text;
alter table players add column if not exists device_id text;
create unique index if not exists runs_token_uniq on runs (token) where token is not null;
create index if not exists runs_device_idx on runs (device_id, created_at desc);

-- Wheel prizes actually awarded (drives both the 12h lockout and the
-- dashboard). Redemption is tracked (redeemed by staff from the admin
-- dashboard) — one-time, enforced atomically by redeem_wheel_win().
create table if not exists wheel_wins (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references players(id) on delete cascade,
  device_id   text,
  prize_key   text not null,
  prize_label text not null,
  score       integer not null,
  redeemed    boolean not null default false,
  redeemed_at timestamptz,
  redeemed_by text,                  -- staff/terminal identifier
  created_at  timestamptz not null default now()
);
create index if not exists wheel_wins_created_idx on wheel_wins (created_at desc);
create index if not exists wheel_wins_device_idx on wheel_wins (device_id, created_at desc);
create index if not exists wheel_wins_player_idx on wheel_wins (player_id, created_at desc);
create index if not exists wheel_wins_redeemed_idx on wheel_wins (redeemed, created_at desc);

-- Backfill for an already-deployed instance that ran the pre-redemption
-- version of this file (safe no-op on a fresh database).
alter table wheel_wins add column if not exists redeemed    boolean not null default false;
alter table wheel_wins add column if not exists redeemed_at timestamptz;
alter table wheel_wins add column if not exists redeemed_by text;

-- Eligibility for BOTH phone and device: locked after a recent win, or
-- capped after maxPlays rounds inside the rolling window.
create or replace function check_eligibility(
  p_phone text, p_device text, p_window_hrs integer, p_max_plays integer, p_lockout_hrs integer
) returns table (eligible boolean, reason text, locked_until timestamptz,
                 plays_left integer, next_play_at timestamptz)
language plpgsql as $$
declare v_last_win timestamptz; v_plays integer; v_oldest timestamptz;
begin
  -- most recent qualifying win across this phone or device
  select max(w.created_at) into v_last_win
    from wheel_wins w join players p on p.id = w.player_id
   where w.created_at > now() - make_interval(hours => p_lockout_hrs)
     and (p.phone = p_phone or w.device_id = p_device);

  if v_last_win is not null then
    eligible := false; reason := 'locked_win';
    locked_until := v_last_win + make_interval(hours => p_lockout_hrs);
    next_play_at := locked_until; plays_left := 0;
    return next; return;
  end if;

  select count(*) into v_plays
    from runs r join players p on p.id = r.player_id
   where r.created_at > now() - make_interval(hours => p_window_hrs)
     and (p.phone = p_phone or r.device_id = p_device);

  if v_plays >= p_max_plays then
    -- next slot frees when the oldest of the most-recent maxPlays ages out
    select r.created_at into v_oldest
      from runs r join players p on p.id = r.player_id
     where r.created_at > now() - make_interval(hours => p_window_hrs)
       and (p.phone = p_phone or r.device_id = p_device)
     order by r.created_at desc offset (p_max_plays - 1) limit 1;
    eligible := false; reason := 'daily_cap';
    next_play_at := v_oldest + make_interval(hours => p_window_hrs);
    plays_left := 0; return next; return;
  end if;

  eligible := true; reason := 'ok'; plays_left := p_max_plays - v_plays;
  return next;
end $$;

-- Grant a play: upsert the player, re-check eligibility atomically,
-- then record a run row with a fresh one-time token.
create or replace function start_play(
  p_phone text, p_cc text, p_device text,
  p_window_hrs integer, p_max_plays integer, p_lockout_hrs integer, p_month text
) returns table (ok boolean, reason text, token uuid, plays_left integer, next_play_at timestamptz)
language plpgsql as $$
declare v_player uuid; v_elig record; v_token uuid;
begin
  insert into players (phone, country_code, device_id, consent)
  values (p_phone, p_cc, p_device, true)
  on conflict (phone) do update
    set device_id = coalesce(p_device, players.device_id), last_seen_at = now()
  returning id into v_player;

  select * into v_elig from check_eligibility(p_phone, p_device, p_window_hrs, p_max_plays, p_lockout_hrs);
  if not v_elig.eligible then
    ok := false; reason := v_elig.reason; next_play_at := v_elig.next_play_at;
    plays_left := 0; return next; return;
  end if;

  v_token := gen_random_uuid();
  insert into runs (player_id, score, month_key, device_id, token, token_used)
  values (v_player, 0, p_month, p_device, v_token, false);

  ok := true; reason := 'ok'; token := v_token;
  plays_left := greatest(0, v_elig.plays_left - 1);
  return next;
end $$;

-- Consume a token with the finished score. The wheel is gated on the
-- player's real ORDER-POINTS balance (not the score): a spin needs
-- p_points_threshold points and SPENDS them. Score is still recorded and
-- anti-cheat-flagged, it just no longer unlocks the wheel. Server decides
-- the weighted prize so a tampered client can't pick its own.
-- (Old signature had p_threshold as a SCORE gate — dropped so the param
--  list change doesn't collide with create-or-replace.)
drop function if exists resolve_run(uuid, integer, integer, text, integer, integer, integer, jsonb);
create or replace function resolve_run(
  p_token uuid, p_score integer, p_duration integer, p_device text,
  p_points_threshold integer, p_min_ms integer, p_max_score integer, p_prizes jsonb
) returns table (ok boolean, won boolean, prize jsonb, suspicious boolean, gap integer, order_points integer)
language plpgsql as $$
declare
  v_run runs%rowtype; v_elapsed_ms numeric; v_susp boolean := false;
  v_total numeric := 0; v_r numeric; v_acc numeric := 0; v_prize jsonb; elem jsonb;
  v_points integer := 0;
begin
  select * into v_run from runs where token = p_token and token_used = false for update;
  if not found then
    ok := false; won := false; return next; return;
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_run.created_at)) * 1000;
  if p_score > p_max_score then v_susp := true; end if;          -- impossible score
  if coalesce(p_duration, 0) < p_min_ms then v_susp := true; end if;  -- too fast
  if v_elapsed_ms > 900000 then v_susp := true; end if;         -- token > 15 min = replay

  update runs set score = p_score, duration_ms = p_duration, token_used = true,
                  suspicious = v_susp,
                  client_meta = case when v_susp then '{"reason":"resolve_flag"}'::jsonb else null end
   where id = v_run.id;

  -- Lock the player row and read the authoritative order-points balance.
  select p.order_points into v_points from players p where p.id = v_run.player_id for update;
  v_points := coalesce(v_points, 0);

  if v_points >= p_points_threshold and not v_susp then
    -- Spend the points via the ledger ONLY (the apply_ledger_delta trigger
    -- updates players.order_points — never touch it directly here or the
    -- deduction is applied twice).
    insert into points_ledger (player_id, delta, reason, source, note)
    values (v_run.player_id, -p_points_threshold, 'wheel_spend', 'manual', 'wheel spin spend');

    select sum((e->>'weight')::numeric) into v_total from jsonb_array_elements(p_prizes) e;
    v_r := random() * v_total;
    for elem in select * from jsonb_array_elements(p_prizes) loop
      v_acc := v_acc + (elem->>'weight')::numeric;
      if v_r <= v_acc then v_prize := elem; exit; end if;
    end loop;
    if v_prize is null then v_prize := p_prizes->0; end if;

    insert into wheel_wins (player_id, device_id, prize_key, prize_label, score)
    values (v_run.player_id, p_device, v_prize->>'key', v_prize->>'label', p_score);

    -- Re-read the post-spend balance (the trigger has already applied).
    select p.order_points into v_points from players p where p.id = v_run.player_id;
    ok := true; won := true; prize := v_prize; suspicious := false; gap := 0;
    order_points := coalesce(v_points, 0);
  else
    ok := true; won := false; suspicious := v_susp;
    gap := greatest(0, p_points_threshold - v_points);
    order_points := v_points;
  end if;
  return next;
end $$;

-- ============================================================
-- CLIENT DASHBOARD v2 (July 2026): redemption tracking + the
-- paginated/searchable RPCs the owner dashboard calls. Safe to
-- re-run (idempotent).
-- ============================================================

-- One-time, atomic redemption. Called by staff from the dashboard
-- when a customer shows their prize at checkout.
create or replace function redeem_wheel_win(p_win_id bigint, p_redeemed_by text)
returns table (ok boolean, error text, prize_label text, redeemed_at timestamptz)
language plpgsql as $$
declare v_win wheel_wins%rowtype;
begin
  select * into v_win from wheel_wins where id = p_win_id for update;
  if not found then
    ok := false; error := 'not_found'; return next; return;
  end if;
  if v_win.redeemed then
    ok := false; error := 'already_redeemed';
    prize_label := v_win.prize_label; redeemed_at := v_win.redeemed_at;
    return next; return;
  end if;

  update wheel_wins
     set redeemed = true, redeemed_at = now(), redeemed_by = p_redeemed_by
   where id = p_win_id
  returning prize_label, redeemed_at into prize_label, redeemed_at;

  ok := true; error := null;
  return next;
end $$;

-- Paginated, searchable player list (Players tab). Search matches
-- anywhere in the phone number.
create or replace function admin_players_list(
  p_search text default null, p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql as $$
declare v_total integer;
begin
  select count(*) into v_total from players pl
   where p_search is null or pl.phone ilike '%' || p_search || '%';

  return jsonb_build_object(
    'total', v_total,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'phone', t.phone, 'firstSeen', t.created_at, 'lastSeen', t.last_seen_at,
        'plays', t.plays, 'highScore', t.high_score, 'points', t.order_points,
        'wins', t.wins, 'redeemed', t.redeemed, 'flagged', t.flagged
      ) order by t.created_at desc)
      from (
        select pl.phone, pl.created_at, pl.last_seen_at, pl.high_score, pl.order_points,
               (select count(*) from runs r where r.player_id = pl.id) as plays,
               (select count(*) from wheel_wins w where w.player_id = pl.id) as wins,
               (select count(*) from wheel_wins w where w.player_id = pl.id and w.redeemed) as redeemed,
               (jsonb_array_length(pl.flags) > 0) as flagged
          from players pl
         where p_search is null or pl.phone ilike '%' || p_search || '%'
         order by pl.created_at desc
         limit p_limit offset p_offset
      ) t), '[]'::jsonb)
  );
end $$;

-- Single-player drill-down (Players tab -> row click).
create or replace function admin_player_detail(p_phone text)
returns jsonb language plpgsql as $$
declare v_player players%rowtype;
begin
  select * into v_player from players where phone = p_phone;
  if not found then return null; end if;

  return jsonb_build_object(
    'player', jsonb_build_object(
      'phone', v_player.phone, 'firstSeen', v_player.created_at, 'lastSeen', v_player.last_seen_at,
      'points', v_player.order_points, 'highScore', v_player.high_score, 'games', v_player.games,
      'flags', v_player.flags
    ),
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
                'score', r.score, 'at', r.created_at, 'suspicious', r.suspicious) order by r.created_at desc)
              from (select * from runs where player_id = v_player.id order by created_at desc limit 20) r), '[]'::jsonb),
    'wins', coalesce((select jsonb_agg(jsonb_build_object(
                'prize', w.prize_label, 'score', w.score, 'at', w.created_at,
                'redeemed', w.redeemed, 'redeemedAt', w.redeemed_at, 'redeemedBy', w.redeemed_by, 'id', w.id)
                order by w.created_at desc)
              from wheel_wins w where w.player_id = v_player.id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object(
                'delta', l.delta, 'reason', l.reason, 'source', l.source, 'at', l.created_at) order by l.created_at desc)
              from (select * from points_ledger where player_id = v_player.id order by created_at desc limit 20) l), '[]'::jsonb)
  );
end $$;

-- Paginated redemption feed (Redemptions tab), optionally date-ranged.
create or replace function admin_redemptions(
  p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql as $$
declare v_total integer; v_redeemed integer;
begin
  select count(*) into v_total from wheel_wins w
   where (p_from is null or w.created_at >= p_from)
     and (p_to   is null or w.created_at <  p_to);
  select count(*) into v_redeemed from wheel_wins w
   where w.redeemed
     and (p_from is null or w.created_at >= p_from)
     and (p_to   is null or w.created_at <  p_to);

  return jsonb_build_object(
    'total', v_total,
    'redeemed', v_redeemed,
    'rate', case when v_total = 0 then 0 else round(v_redeemed::numeric / v_total * 100, 1) end,
    'perDay', coalesce((select jsonb_agg(jsonb_build_object(
                 'day', t.day, 'won', t.won, 'redeemed', t.redeemed) order by t.day)
               from (
                 select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day,
                        count(*) as won, count(*) filter (where redeemed) as redeemed
                   from wheel_wins w
                  where (p_from is null or w.created_at >= p_from)
                    and (p_to   is null or w.created_at <  p_to)
                  group by 1
               ) t), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'phone', t.phone, 'prize', t.prize_label, 'score', t.score,
        'wonAt', t.created_at, 'redeemed', t.redeemed, 'redeemedAt', t.redeemed_at, 'redeemedBy', t.redeemed_by
      ) order by t.created_at desc)
      from (
        select w.id, p2.phone, w.prize_label, w.score, w.created_at, w.redeemed, w.redeemed_at, w.redeemed_by
          from wheel_wins w join players p2 on p2.id = w.player_id
         where (p_from is null or w.created_at >= p_from)
           and (p_to   is null or w.created_at <  p_to)
         order by w.created_at desc
         limit p_limit offset p_offset
      ) t), '[]'::jsonb)
  );
end $$;

-- Engagement analytics (Engagement tab): plays/day, score distribution,
-- peak play hour-of-day, and drop-off (started vs. actually finished).
-- A run counts as "abandoned" (not just still in progress) once its
-- 15-minute token window has definitely closed — the same window
-- resolve_run() itself uses to flag a stale token as a replay.
create or replace function admin_engagement(p_days integer default 14)
returns jsonb language plpgsql as $$
declare v_since timestamptz := now() - make_interval(days => p_days);
begin
  return jsonb_build_object(
    'playsPerDay', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'n', t.n) order by t.day)
                    from (select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day, count(*) as n
                          from runs where created_at > v_since group by 1) t), '[]'::jsonb),
    'scoreDist', coalesce((select jsonb_agg(jsonb_build_object('bucket', t.bucket, 'n', t.n) order by t.bucket)
                   from (select (score / 1000) * 1000 as bucket, count(*) as n
                         from runs where created_at > v_since and token_used group by 1) t), '[]'::jsonb),
    'peakHours', coalesce((select jsonb_agg(jsonb_build_object('hour', t.hour, 'n', t.n) order by t.hour)
                   from (select extract(hour from created_at at time zone 'Africa/Cairo')::int as hour, count(*) as n
                         from runs where created_at > v_since group by 1) t), '[]'::jsonb),
    'dropOff', jsonb_build_object(
      'started',   (select count(*) from runs where created_at > v_since),
      'finished',  (select count(*) from runs where created_at > v_since and token_used),
      'abandoned', (select count(*) from runs
                     where created_at > v_since and not token_used
                       and created_at < now() - interval '15 minutes')
    )
  );
end $$;

-- ============================================================
-- CLIENT-FACING dashboard (per-restaurant performance). One call,
-- date-range driven, with the previous equal-length period for
-- growth. "Revenue" = real order value captured in points_ledger.
-- amount_egp (order value) is only present from the day it started
-- being stored, so pre-that revenue reads as 0 by design.
-- ============================================================
create or replace function client_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql as $$
declare
  v_len   interval    := p_to - p_from;
  v_pfrom timestamptz := p_from - (p_to - p_from);   -- previous equal window
  v_comm  numeric;
begin
  select coalesce((value)::numeric, 0) into v_comm from settings where key = 'commission_pct';

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'commissionPct', coalesce(v_comm, 0),

    -- headline numbers for the selected range + the prior equal range
    'revenue',      coalesce((select sum(amount_egp) from points_ledger
                       where reason = 'order' and created_at >= p_from and created_at < p_to), 0),
    'revenuePrev',  coalesce((select sum(amount_egp) from points_ledger
                       where reason = 'order' and created_at >= v_pfrom and created_at < p_from), 0),
    'orders',       (select count(*) from points_ledger
                       where reason = 'order' and created_at >= p_from and created_at < p_to),
    'ordersPrev',   (select count(*) from points_ledger
                       where reason = 'order' and created_at >= v_pfrom and created_at < p_from),
    'codeUses',     (select count(*) from wheel_wins
                       where redeemed and redeemed_at >= p_from and redeemed_at < p_to),
    'codeUsesPrev', (select count(*) from wheel_wins
                       where redeemed and redeemed_at >= v_pfrom and redeemed_at < p_from),
    'newCustomers', (select count(*) from players where created_at >= p_from and created_at < p_to),

    -- reward -> order conversion (redeemed vs. won) inside the range
    'winsInRange',     (select count(*) from wheel_wins where created_at >= p_from and created_at < p_to),
    'redeemedInRange', (select count(*) from wheel_wins where redeemed and redeemed_at >= p_from and redeemed_at < p_to),

    -- revenue + orders per day, for the performance chart
    'series', coalesce((select jsonb_agg(jsonb_build_object(
                  'day', t.day, 'revenue', t.rev, 'orders', t.n) order by t.day)
                from (select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day,
                             coalesce(sum(amount_egp), 0) as rev, count(*) as n
                        from points_ledger
                       where reason = 'order' and created_at >= p_from and created_at < p_to
                       group by 1) t), '[]'::jsonb),

    -- top rewards redeemed (stands in for "top products" until Foodics
    -- line-items are ingested; order totals carry no product breakdown)
    'topRewards', coalesce((select jsonb_agg(jsonb_build_object('label', t.prize_label, 'n', t.n) order by t.n desc)
                    from (select prize_label, count(*) as n from wheel_wins
                           where redeemed and redeemed_at >= p_from and redeemed_at < p_to
                           group by 1 order by 2 desc limit 6) t), '[]'::jsonb),

    -- recent orders placed through the program
    'recentOrders', coalesce((select jsonb_agg(jsonb_build_object(
                       'phone', t.phone, 'amount', t.amount_egp, 'at', t.created_at) order by t.created_at desc)
                     from (select p2.phone, l.amount_egp, l.created_at
                             from points_ledger l join players p2 on p2.id = l.player_id
                            where l.reason = 'order' and l.created_at >= p_from and l.created_at < p_to
                            order by l.created_at desc limit 12) t), '[]'::jsonb)
  );
end $$;

-- ============================================================
-- COMPETITION REMOVAL CLEANUP (July 2026): drops the leftover
-- competition scaffolding from the pre-wheel model. Safe to re-run;
-- also cleans up an already-deployed Supabase instance.
-- ============================================================
drop view if exists leaderboard;
drop function if exists submit_competition_run(uuid, text, integer, integer, integer);
drop function if exists mask_phone(text);
drop table if exists competition_winners;
drop table if exists competition_entries;
alter table runs drop column if exists is_competition;

-- ---- lock everything down --------------------------------------
alter table players             enable row level security;
alter table points_ledger      enable row level security;
alter table runs               enable row level security;
alter table wheel_wins         enable row level security;
alter table settings           enable row level security;
-- (no policies on purpose: anon key sees nothing; service role bypasses RLS)

-- ============================================================
-- 2026-08-07 — resolve_run gains a SURVIVAL gate (ADR 0004/0009)
--
-- Winning a round means surviving its full duration; only a won round may
-- draw a prize. The previous signature had no survival input at all, so a
-- player eliminated by bombs still spent their points and drew a prize as
-- long as their balance cleared the threshold.
--
-- `p_survived` is computed SERVER-SIDE in api/submit-run.mjs from the round
-- duration (see the comment there) — it is never the client's own claim.
--
-- The token is still consumed either way: the play is spent whether or not
-- the player survived, which is what stops a losing round being retried for
-- free. Only the prize draw is gated.
--
-- Additive and idempotent, matching this file's convention. The old
-- 8-argument overload is dropped so a stale deployment cannot silently keep
-- resolving runs without the gate — a missing-function error is a loud,
-- fail-closed failure, which is the correct outcome for reward code.
-- ============================================================
drop function if exists resolve_run(uuid, integer, integer, text, integer, integer, integer, jsonb);
drop function if exists resolve_run(uuid, integer, integer, text, integer, integer, integer, jsonb, boolean);
create or replace function resolve_run(
  p_token uuid, p_score integer, p_duration integer, p_device text,
  p_points_threshold integer, p_min_ms integer, p_max_score integer, p_prizes jsonb,
  p_survived boolean
) returns table (ok boolean, won boolean, prize jsonb, suspicious boolean, gap integer, order_points integer)
language plpgsql as $$
declare
  v_run runs%rowtype; v_elapsed_ms numeric; v_susp boolean := false;
  v_total numeric := 0; v_r numeric; v_acc numeric := 0; v_prize jsonb; elem jsonb;
  v_points integer := 0;
begin
  select * into v_run from runs where token = p_token and token_used = false for update;
  if not found then
    ok := false; won := false; return next; return;
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_run.created_at)) * 1000;
  if p_score > p_max_score then v_susp := true; end if;          -- impossible score
  if coalesce(p_duration, 0) < p_min_ms then v_susp := true; end if;  -- too fast
  if v_elapsed_ms > 900000 then v_susp := true; end if;         -- token > 15 min = replay

  -- A survival claim the server's own clock cannot support is suspicious: the
  -- token was issued when the round started, so a genuine full round cannot
  -- have taken less wall-clock time than it claims to have lasted.
  if coalesce(p_survived, false) and v_elapsed_ms < coalesce(p_duration, 0) * 0.9 then
    v_susp := true;
  end if;

  update runs set score = p_score, duration_ms = p_duration, token_used = true,
                  suspicious = v_susp,
                  client_meta = case when v_susp then '{"reason":"resolve_flag"}'::jsonb else null end
   where id = v_run.id;

  -- Lock the player row and read the authoritative order-points balance.
  select p.order_points into v_points from players p where p.id = v_run.player_id for update;
  v_points := coalesce(v_points, 0);

  -- THE GATE: survived AND enough points AND not flagged.
  if coalesce(p_survived, false) and v_points >= p_points_threshold and not v_susp then
    -- Spend the points via the ledger ONLY (the apply_ledger_delta trigger
    -- updates players.order_points — never touch it directly here or the
    -- deduction is applied twice).
    insert into points_ledger (player_id, delta, reason, source, note)
    values (v_run.player_id, -p_points_threshold, 'wheel_spend', 'manual', 'wheel spin spend');

    select sum((e->>'weight')::numeric) into v_total from jsonb_array_elements(p_prizes) e;
    v_r := random() * v_total;
    for elem in select * from jsonb_array_elements(p_prizes) loop
      v_acc := v_acc + (elem->>'weight')::numeric;
      if v_r <= v_acc then v_prize := elem; exit; end if;
    end loop;
    if v_prize is null then v_prize := p_prizes->0; end if;

    insert into wheel_wins (player_id, device_id, prize_key, prize_label, score)
    values (v_run.player_id, p_device, v_prize->>'key', v_prize->>'label', p_score);

    -- Re-read the post-spend balance (the trigger has already applied).
    select p.order_points into v_points from players p where p.id = v_run.player_id;
    ok := true; won := true; prize := v_prize; suspicious := false; gap := 0;
    order_points := coalesce(v_points, 0);
  else
    ok := true; won := false; suspicious := v_susp;
    gap := greatest(0, p_points_threshold - v_points);
    order_points := v_points;
  end if;
  return next;
end $$;

-- Settings the survival gate reads (api/submit-run.mjs). Tunable without a
-- redeploy, per .claude/rules/database-migrations.md.
insert into settings (key, value) values
  ('round_time_sec', '30'::jsonb),
  ('survival_tolerance', '0.95'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- 2026-08-11 — coupon codes minted with the win (ADR 0016)
--
-- The wheel reveal shows the player a code they take to the counter. That code
-- MUST be minted in the same row-locked transaction that recorded the win, or
-- it becomes a value the client can request independently of an award — which
-- is the whole class of bug ADR 0009 closed.
--
-- Additive and idempotent, matching this file's convention.
-- ============================================================
alter table wheel_wins add column if not exists code text;
alter table wheel_wins add column if not exists expires_at timestamptz;
-- A code is a bearer token: two players must never hold the same one.
create unique index if not exists wheel_wins_code_uniq on wheel_wins (code) where code is not null;

-- Human-readable, unambiguous coupon codes.
-- Excludes I/O/0/1 so a code read aloud at a counter cannot be mistyped, which
-- is a real support cost rather than a theoretical one.
--
-- CRYPTOGRAPHIC randomness, not `random()`. A coupon is a bearer token worth
-- real money: anyone holding the string can claim the prize. Postgres's
-- `random()` is a deterministic PRNG shared per session, so codes drawn from it
-- are correlated — observing a handful of issued codes narrows the search for
-- others, and nothing about the format stops a guesser trying. `gen_random_bytes`
-- (pgcrypto) has no such relationship between draws.
--
-- The alphabet is exactly 32 characters, which is what makes `& 31` an UNBIASED
-- selection: 32 divides 256 evenly, so every character is equally likely. Change
-- the alphabet length and that stops being true — a modulo of a non-power-of-two
-- would quietly favour the first characters.
create extension if not exists pgcrypto;

create or replace function mint_coupon_code(p_prefix text default 'MC')
returns text language plpgsql as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_bytes bytea;
  v_try integer := 0;
begin
  loop
    v_code := p_prefix || '-';
    v_bytes := gen_random_bytes(8);
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i - 1) & 31), 1);
      if i = 4 then v_code := v_code || '-'; end if;
    end loop;
    -- The unique index is the real guarantee; this loop just avoids surfacing
    -- a constraint violation for an ordinary collision.
    exit when not exists (select 1 from wheel_wins w where w.code = v_code);
    v_try := v_try + 1;
    if v_try > 12 then
      -- 32^8 space; a dozen collisions means something is badly wrong.
      raise exception 'mint_coupon_code: could not find a free code';
    end if;
  end loop;
  return v_code;
end $$;

drop function if exists resolve_run(uuid, integer, integer, text, integer, integer, integer, jsonb, boolean);
create or replace function resolve_run(
  p_token uuid, p_score integer, p_duration integer, p_device text,
  p_points_threshold integer, p_min_ms integer, p_max_score integer, p_prizes jsonb,
  p_survived boolean
) returns table (ok boolean, won boolean, prize jsonb, suspicious boolean, gap integer,
                 order_points integer, code text, expires_at timestamptz)
language plpgsql as $$
declare
  v_run runs%rowtype; v_elapsed_ms numeric; v_susp boolean := false;
  v_total numeric := 0; v_r numeric; v_acc numeric := 0; v_prize jsonb; elem jsonb;
  v_points integer := 0; v_code text; v_expires timestamptz;
begin
  select * into v_run from runs where token = p_token and token_used = false for update;
  if not found then
    ok := false; won := false; return next; return;
  end if;

  v_elapsed_ms := extract(epoch from (now() - v_run.created_at)) * 1000;
  if p_score > p_max_score then v_susp := true; end if;
  if coalesce(p_duration, 0) < p_min_ms then v_susp := true; end if;
  if v_elapsed_ms > 900000 then v_susp := true; end if;
  if coalesce(p_survived, false) and v_elapsed_ms < coalesce(p_duration, 0) * 0.9 then
    v_susp := true;
  end if;

  update runs set score = p_score, duration_ms = p_duration, token_used = true,
                  suspicious = v_susp,
                  client_meta = case when v_susp then '{"reason":"resolve_flag"}'::jsonb else null end
   where id = v_run.id;

  select p.order_points into v_points from players p where p.id = v_run.player_id for update;
  v_points := coalesce(v_points, 0);

  if coalesce(p_survived, false) and v_points >= p_points_threshold and not v_susp then
    insert into points_ledger (player_id, delta, reason, source, note)
    values (v_run.player_id, -p_points_threshold, 'wheel_spend', 'manual', 'wheel spin spend');

    select sum((e->>'weight')::numeric) into v_total from jsonb_array_elements(p_prizes) e;
    v_r := random() * v_total;
    for elem in select * from jsonb_array_elements(p_prizes) loop
      v_acc := v_acc + (elem->>'weight')::numeric;
      if v_r <= v_acc then v_prize := elem; exit; end if;
    end loop;
    if v_prize is null then v_prize := p_prizes->0; end if;

    -- Mint INSIDE this transaction: the code and the win are one atomic fact.
    v_code := mint_coupon_code('MC');
    v_expires := now() + interval '14 days';

    insert into wheel_wins (player_id, device_id, prize_key, prize_label, score, code, expires_at)
    values (v_run.player_id, p_device, v_prize->>'key', v_prize->>'label', p_score, v_code, v_expires);

    select p.order_points into v_points from players p where p.id = v_run.player_id;
    ok := true; won := true; prize := v_prize; suspicious := false; gap := 0;
    order_points := coalesce(v_points, 0); code := v_code; expires_at := v_expires;
  else
    ok := true; won := false; suspicious := v_susp;
    gap := greatest(0, p_points_threshold - v_points);
    order_points := v_points; code := null; expires_at := null;
  end if;
  return next;
end $$;

-- ============================================================
-- 2026-08-12 — coupon code on the redemption feed
--
-- The admin dashboard's Redemptions tab identifies which coupon a row is, so
-- the code has to come back with the row. `admin_redemptions` was written
-- before wheel_wins.code existed (added 2026-08-11, ADR 0016), so it is
-- re-declared HERE rather than edited in place: this file is applied
-- top-to-bottom by hand, and the original declaration sits above the
-- `alter table ... add column code` that this body depends on.
--
-- ONLY THE LAST FOUR CHARACTERS ARE RETURNED, and the truncation happens
-- HERE rather than in the browser. A coupon code is a BEARER TOKEN — anyone
-- holding the string can claim the prize at a counter — which is a different
-- class of value from a phone number. The dashboard only ever displays it
-- masked, so shipping the whole code to a browser would be exposure that buys
-- nothing: an XSS, a shared screen or a leaked devtools capture would hand
-- over live, spendable codes. Redemption from the dashboard goes through
-- redeem_wheel_win(win_id), which never needs the code, so nothing downstream
-- wants the full value. If code LOOKUP is ever needed (a customer reads a code
-- aloud), add a dedicated endpoint that takes a code and returns a win id —
-- comparison in that direction leaks nothing.
--
-- Additive and idempotent, matching this file's convention. The dashboard
-- renders a missing tail as "—", so it degrades cleanly on an instance where
-- this section has not been applied yet.
-- ============================================================
create or replace function admin_redemptions(
  p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql as $$
declare v_total integer; v_redeemed integer;
begin
  select count(*) into v_total from wheel_wins w
   where (p_from is null or w.created_at >= p_from)
     and (p_to   is null or w.created_at <  p_to);
  select count(*) into v_redeemed from wheel_wins w
   where w.redeemed
     and (p_from is null or w.created_at >= p_from)
     and (p_to   is null or w.created_at <  p_to);

  return jsonb_build_object(
    'total', v_total,
    'redeemed', v_redeemed,
    'rate', case when v_total = 0 then 0 else round(v_redeemed::numeric / v_total * 100, 1) end,
    'perDay', coalesce((select jsonb_agg(jsonb_build_object(
                 'day', t.day, 'won', t.won, 'redeemed', t.redeemed) order by t.day)
               from (
                 select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day,
                        count(*) as won, count(*) filter (where redeemed) as redeemed
                   from wheel_wins w
                  where (p_from is null or w.created_at >= p_from)
                    and (p_to   is null or w.created_at <  p_to)
                  group by 1
               ) t), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'phone', t.phone, 'prize', t.prize_label, 'score', t.score,
        'codeTail', right(t.code, 4), 'expiresAt', t.expires_at,
        'wonAt', t.created_at, 'redeemed', t.redeemed, 'redeemedAt', t.redeemed_at, 'redeemedBy', t.redeemed_by
      ) order by t.created_at desc)
      from (
        select w.id, p2.phone, w.prize_label, w.score, w.code, w.expires_at,
               w.created_at, w.redeemed, w.redeemed_at, w.redeemed_by
          from wheel_wins w join players p2 on p2.id = w.player_id
         where (p_from is null or w.created_at >= p_from)
           and (p_to   is null or w.created_at <  p_to)
         order by w.created_at desc
         limit p_limit offset p_offset
      ) t), '[]'::jsonb)
  );
end $$;
