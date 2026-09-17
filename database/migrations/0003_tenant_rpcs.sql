-- ============================================================
-- 0003 — Tenant-scoped business logic (ADR 0018).
--
-- Every RPC from supabase/schema.sql, re-issued with the SAME
-- signature so api/*.mjs call them unchanged. What changes:
--
--   • each function resolves its tenant ONCE, from current_tenant()
--     (the verified JWT claim), never from an argument;
--   • every read and write carries an explicit `tenant_id = v_tenant`
--     predicate. RLS (0004) enforces the same boundary underneath; the
--     explicit predicate is what keeps the answer correct for a role
--     RLS lets see more than one tenant (ops_admin), and is what makes
--     each query auditable on its own;
--   • paths that start or pay a round require a LIVE tenant.
--
-- The reward logic itself — row locks, the survival gate, the
-- weighted draw, the in-transaction coupon mint — is unchanged apart
-- from the tenant predicate and the tenant's coupon prefix.
-- ============================================================
begin;

create or replace function apply_ledger_delta() returns trigger language plpgsql as $$
begin
  update players
     set order_points = greatest(0, order_points + new.delta)
   where id = new.player_id and tenant_id = new.tenant_id;
  return new;
end $$;

-- ---- POS credit --------------------------------------------------------------
-- Not gated on a live tenant: a till keeps selling while a campaign is paused,
-- and losing those orders' points would be a customer-facing error.
create or replace function credit_order_points(
  p_phone text, p_order_id text, p_points integer, p_source text default 'manual',
  p_note text default null, p_amount_egp numeric default null
) returns table (player_id uuid, new_balance integer, duplicate boolean)
language plpgsql as $$
declare v_tenant uuid := require_tenant(); v_player uuid;
begin
  if p_order_id is not null and exists (
    select 1 from points_ledger l where l.tenant_id = v_tenant and l.order_id = p_order_id
  ) then
    select pl.id, pl.order_points into v_player, new_balance
      from points_ledger l
      join players pl on pl.tenant_id = l.tenant_id and pl.id = l.player_id
     where l.tenant_id = v_tenant and l.order_id = p_order_id
     limit 1;
    player_id := v_player; duplicate := true;
    return next; return;
  end if;

  insert into players (tenant_id, phone) values (v_tenant, p_phone)
  on conflict (tenant_id, phone) do update set last_seen_at = now()
  returning id into v_player;

  insert into points_ledger (tenant_id, player_id, delta, reason, order_id, source, note, amount_egp)
  values (v_tenant, v_player, p_points, 'order', p_order_id, p_source, p_note, p_amount_egp);

  select pl.order_points into new_balance from players pl
   where pl.tenant_id = v_tenant and pl.id = v_player;
  player_id := v_player; duplicate := false;
  return next;
end $$;

-- ---- eligibility + round start -------------------------------------------------
-- Lockouts are per brand: a win at one restaurant does not lock the same phone
-- or device out of another restaurant's campaign.
create or replace function check_eligibility(
  p_phone text, p_device text, p_window_hrs integer, p_max_plays integer, p_lockout_hrs integer
) returns table (eligible boolean, reason text, locked_until timestamptz,
                 plays_left integer, next_play_at timestamptz)
language plpgsql as $$
declare v_tenant uuid := require_tenant(); v_last_win timestamptz; v_plays integer; v_oldest timestamptz;
begin
  select max(w.created_at) into v_last_win
    from wheel_wins w join players p on p.tenant_id = w.tenant_id and p.id = w.player_id
   where w.tenant_id = v_tenant
     and w.created_at > now() - make_interval(hours => p_lockout_hrs)
     and (p.phone = p_phone or w.device_id = p_device);

  if v_last_win is not null then
    eligible := false; reason := 'locked_win';
    locked_until := v_last_win + make_interval(hours => p_lockout_hrs);
    next_play_at := locked_until; plays_left := 0;
    return next; return;
  end if;

  select count(*) into v_plays
    from runs r join players p on p.tenant_id = r.tenant_id and p.id = r.player_id
   where r.tenant_id = v_tenant
     and r.created_at > now() - make_interval(hours => p_window_hrs)
     and (p.phone = p_phone or r.device_id = p_device);

  if v_plays >= p_max_plays then
    select r.created_at into v_oldest
      from runs r join players p on p.tenant_id = r.tenant_id and p.id = r.player_id
     where r.tenant_id = v_tenant
       and r.created_at > now() - make_interval(hours => p_window_hrs)
       and (p.phone = p_phone or r.device_id = p_device)
     order by r.created_at desc offset (p_max_plays - 1) limit 1;
    eligible := false; reason := 'daily_cap';
    next_play_at := v_oldest + make_interval(hours => p_window_hrs);
    plays_left := 0; return next; return;
  end if;

  eligible := true; reason := 'ok'; plays_left := p_max_plays - v_plays;
  return next;
end $$;

create or replace function start_play(
  p_phone text, p_cc text, p_device text,
  p_window_hrs integer, p_max_plays integer, p_lockout_hrs integer, p_month text
) returns table (ok boolean, reason text, token uuid, plays_left integer, next_play_at timestamptz)
language plpgsql as $$
declare v_tenant uuid := require_live_tenant(); v_player uuid; v_elig record; v_token uuid;
begin
  insert into players (tenant_id, phone, country_code, device_id, consent)
  values (v_tenant, p_phone, p_cc, p_device, true)
  on conflict (tenant_id, phone) do update
    set device_id = coalesce(p_device, players.device_id), last_seen_at = now()
  returning id into v_player;

  select * into v_elig from check_eligibility(p_phone, p_device, p_window_hrs, p_max_plays, p_lockout_hrs);
  if not v_elig.eligible then
    ok := false; reason := v_elig.reason; next_play_at := v_elig.next_play_at;
    plays_left := 0; return next; return;
  end if;

  v_token := gen_random_uuid();
  insert into runs (tenant_id, player_id, score, month_key, device_id, token, token_used)
  values (v_tenant, v_player, 0, p_month, p_device, v_token, false);

  ok := true; reason := 'ok'; token := v_token;
  plays_left := greatest(0, v_elig.plays_left - 1);
  return next;
end $$;

-- ---- coupon codes ------------------------------------------------------------
-- The global unique index on wheel_wins.code is the real guarantee. Under RLS
-- this pre-check can only see the caller's own tenant, so a collision with
-- another tenant's code (1 in ~10^12 per draw) surfaces as a unique violation
-- that rolls the whole resolve_run back — the token included — rather than as
-- a duplicate code.
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
    exit when not exists (select 1 from wheel_wins w where w.code = v_code);
    v_try := v_try + 1;
    if v_try > 12 then
      raise exception 'mint_coupon_code: could not find a free code';
    end if;
  end loop;
  return v_code;
end $$;

-- ---- resolve a round ---------------------------------------------------------
create or replace function resolve_run(
  p_token uuid, p_score integer, p_duration integer, p_device text,
  p_points_threshold integer, p_min_ms integer, p_max_score integer, p_prizes jsonb,
  p_survived boolean
) returns table (ok boolean, won boolean, prize jsonb, suspicious boolean, gap integer,
                 order_points integer, code text, expires_at timestamptz)
language plpgsql as $$
declare
  v_tenant uuid := require_live_tenant();
  v_run runs%rowtype; v_elapsed_ms numeric; v_susp boolean := false;
  v_total numeric := 0; v_r numeric; v_acc numeric := 0; v_prize jsonb; elem jsonb;
  v_points integer := 0; v_code text; v_expires timestamptz; v_prefix text;
begin
  -- A token from another tenant is simply not found: the same answer as a
  -- forged or already-used token, so it reveals nothing about other tenants.
  select * into v_run from runs
   where tenant_id = v_tenant and token = p_token and token_used = false
   for update;
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
   where tenant_id = v_tenant and id = v_run.id;

  select p.order_points into v_points from players p
   where p.tenant_id = v_tenant and p.id = v_run.player_id
   for update;
  v_points := coalesce(v_points, 0);

  if coalesce(p_survived, false) and v_points >= p_points_threshold and not v_susp then
    insert into points_ledger (tenant_id, player_id, delta, reason, source, note)
    values (v_tenant, v_run.player_id, -p_points_threshold, 'wheel_spend', 'manual', 'wheel spin spend');

    select sum((e->>'weight')::numeric) into v_total from jsonb_array_elements(p_prizes) e;
    v_r := random() * v_total;
    for elem in select * from jsonb_array_elements(p_prizes) loop
      v_acc := v_acc + (elem->>'weight')::numeric;
      if v_r <= v_acc then v_prize := elem; exit; end if;
    end loop;
    if v_prize is null then v_prize := p_prizes->0; end if;

    select t.coupon_prefix into v_prefix from tenants t where t.id = v_tenant;
    v_code := mint_coupon_code(coalesce(v_prefix, 'MC'));
    v_expires := now() + interval '14 days';

    insert into wheel_wins (tenant_id, player_id, device_id, prize_key, prize_label, score, code, expires_at)
    values (v_tenant, v_run.player_id, p_device, v_prize->>'key', v_prize->>'label', p_score, v_code, v_expires);

    select p.order_points into v_points from players p
     where p.tenant_id = v_tenant and p.id = v_run.player_id;
    ok := true; won := true; prize := v_prize; suspicious := false; gap := 0;
    order_points := coalesce(v_points, 0); code := v_code; expires_at := v_expires;
  else
    ok := true; won := false; suspicious := v_susp;
    gap := greatest(0, p_points_threshold - v_points);
    order_points := v_points; code := null; expires_at := null;
  end if;
  return next;
end $$;

-- ---- redemption --------------------------------------------------------------
-- Win ids are sequential. Without the tenant predicate, staff at one brand
-- could redeem another brand's coupon by guessing a neighbouring id.
create or replace function redeem_wheel_win(p_win_id bigint, p_redeemed_by text)
returns table (ok boolean, error text, prize_label text, redeemed_at timestamptz)
language plpgsql as $$
declare v_tenant uuid := require_tenant(); v_win wheel_wins%rowtype;
begin
  select * into v_win from wheel_wins w
   where w.tenant_id = v_tenant and w.id = p_win_id
   for update;
  if not found then
    ok := false; error := 'not_found'; return next; return;
  end if;
  if v_win.redeemed then
    ok := false; error := 'already_redeemed';
    prize_label := v_win.prize_label; redeemed_at := v_win.redeemed_at;
    return next; return;
  end if;

  update wheel_wins w
     set redeemed = true, redeemed_at = now(), redeemed_by = p_redeemed_by
   where w.tenant_id = v_tenant and w.id = p_win_id
  returning w.prize_label, w.redeemed_at into prize_label, redeemed_at;

  ok := true; error := null;
  return next;
end $$;

-- ---- reporting ---------------------------------------------------------------
create or replace function admin_dashboard(
  p_month text default null,
  p_lockout integer default 12, p_maxplays integer default 5)
returns jsonb language plpgsql as $$
declare v_t uuid := require_tenant(); mk text;
begin
  mk := coalesce(p_month, to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM'));
  return jsonb_build_object(
    'monthKey', mk,
    'players', jsonb_build_object(
      'total',   (select count(*) from players where tenant_id = v_t),
      'new7d',   (select count(*) from players where tenant_id = v_t and created_at > now() - interval '7 days'),
      'flagged', (select count(*) from players where tenant_id = v_t and jsonb_array_length(flags) > 0)
    ),
    'points', jsonb_build_object(
      'issued',    coalesce((select sum(delta)  from points_ledger where tenant_id = v_t and delta > 0), 0),
      'deducted',  coalesce((select -sum(delta) from points_ledger where tenant_id = v_t and delta < 0), 0),
      'liability', coalesce((select sum(order_points) from players where tenant_id = v_t), 0)
    ),
    'runs', jsonb_build_object(
      'total',      (select count(*) from runs where tenant_id = v_t),
      'last24h',    (select count(*) from runs where tenant_id = v_t and created_at > now() - interval '24 hours'),
      'month',      (select count(*) from runs where tenant_id = v_t and month_key = mk),
      'avgScore',   coalesce((select round(avg(score)) from runs where tenant_id = v_t and month_key = mk), 0),
      'suspicious', (select count(*) from runs where tenant_id = v_t and suspicious)
    ),
    'wheel', jsonb_build_object(
      'winsTotal',  (select count(*) from wheel_wins where tenant_id = v_t),
      'wins24h',    (select count(*) from wheel_wins where tenant_id = v_t and created_at > now() - interval '24 hours'),
      'winsMonth',  (select count(*) from wheel_wins
                      where tenant_id = v_t
                        and to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM') = mk),
      'byPrize',    coalesce((select jsonb_agg(jsonb_build_object('prize', t.prize_label, 'n', t.n)
                                order by t.n desc)
                      from (select prize_label, count(*) n from wheel_wins
                            where tenant_id = v_t
                              and to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM') = mk
                            group by prize_label) t), '[]'::jsonb),
      'recent',     coalesce((select jsonb_agg(jsonb_build_object(
                        'phone', p2.phone, 'prize', w.prize_label, 'score', w.score, 'at', w.created_at)
                        order by w.created_at desc)
                      from (select * from wheel_wins where tenant_id = v_t
                            order by created_at desc limit 15) w
                      join players p2 on p2.tenant_id = w.tenant_id and p2.id = w.player_id), '[]'::jsonb)
    ),
    'plays', jsonb_build_object(
      'lockedNow',  (select count(distinct w.player_id) from wheel_wins w
                      where w.tenant_id = v_t
                        and w.created_at > now() - make_interval(hours => p_lockout)),
      'cappedToday',(select count(*) from (
                       select r.player_id from runs r
                        where r.tenant_id = v_t and r.created_at > now() - interval '24 hours'
                        group by r.player_id having count(*) >= p_maxplays) c)
    ),
    'redemptions', jsonb_build_object(
      'total',    (select count(*) from wheel_wins where tenant_id = v_t),
      'redeemed', (select count(*) from wheel_wins where tenant_id = v_t and redeemed),
      'rate',     case when (select count(*) from wheel_wins where tenant_id = v_t) = 0 then 0
                    else round((select count(*) from wheel_wins where tenant_id = v_t and redeemed)::numeric
                               / (select count(*) from wheel_wins where tenant_id = v_t) * 100, 1) end
    ),
    'pointsFunnel', coalesce((select jsonb_agg(jsonb_build_object('bucket', b.label, 'n', b.n) order by b.ord)
                     from (
                       select '0-200' as label, 1 as ord, count(*) as n from players
                        where tenant_id = v_t and order_points >= 0 and order_points < 200
                       union all
                       select '200-450', 2, count(*) from players
                        where tenant_id = v_t and order_points >= 200 and order_points < 450
                       union all
                       select '450-650', 3, count(*) from players
                        where tenant_id = v_t and order_points >= 450 and order_points < 650
                       union all
                       select '650+',    4, count(*) from players
                        where tenant_id = v_t and order_points >= 650
                     ) b), '[]'::jsonb),
    'topHolders', coalesce((select jsonb_agg(jsonb_build_object(
                      'phone', t.phone, 'points', t.order_points) order by t.order_points desc)
                    from (select phone, order_points from players
                          where tenant_id = v_t and order_points > 0
                          order by order_points desc limit 10) t), '[]'::jsonb),
    'recentSignups', coalesce((select jsonb_agg(jsonb_build_object(
                        'phone', t.phone, 'at', t.created_at, 'points', t.order_points) order by t.created_at desc)
                      from (select phone, created_at, order_points from players
                            where tenant_id = v_t
                            order by created_at desc limit 10) t), '[]'::jsonb),
    'flaggedPlayers', coalesce((select jsonb_agg(jsonb_build_object(
                         'phone', t.phone, 'flags', t.flags, 'points', t.order_points))
                       from (select phone, flags, order_points from players
                             where tenant_id = v_t and jsonb_array_length(flags) > 0 limit 20) t), '[]'::jsonb),
    'suspiciousRuns', coalesce((select jsonb_agg(jsonb_build_object(
                         'phone', p2.phone, 'score', r.score, 'at', r.created_at,
                         'meta', r.client_meta) order by r.created_at desc)
                       from (select * from runs where tenant_id = v_t and suspicious
                             order by created_at desc limit 20) r
                       join players p2 on p2.tenant_id = r.tenant_id and p2.id = r.player_id), '[]'::jsonb),
    'scoreDist', coalesce((select jsonb_agg(jsonb_build_object('bucket', t.bucket, 'n', t.n) order by t.bucket)
                   from (select (score / 1000) * 1000 as bucket, count(*) as n
                         from runs where tenant_id = v_t and month_key = mk group by 1) t), '[]'::jsonb),
    'runsPerDay', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'n', t.n) order by t.day)
                    from (select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day, count(*) as n
                          from runs where tenant_id = v_t and created_at > now() - interval '14 days'
                          group by 1) t), '[]'::jsonb)
  );
end $$;

create or replace function admin_players_list(
  p_search text default null, p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql as $$
declare v_t uuid := require_tenant(); v_total integer;
begin
  select count(*) into v_total from players pl
   where pl.tenant_id = v_t and (p_search is null or pl.phone ilike '%' || p_search || '%');

  return jsonb_build_object(
    'total', v_total,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'phone', t.phone, 'firstSeen', t.created_at, 'lastSeen', t.last_seen_at,
        'plays', t.plays, 'highScore', t.high_score, 'points', t.order_points,
        'wins', t.wins, 'redeemed', t.redeemed, 'flagged', t.flagged
      ) order by t.created_at desc)
      from (
        select pl.phone, pl.created_at, pl.last_seen_at, pl.high_score, pl.order_points,
               (select count(*) from runs r where r.tenant_id = v_t and r.player_id = pl.id) as plays,
               (select count(*) from wheel_wins w where w.tenant_id = v_t and w.player_id = pl.id) as wins,
               (select count(*) from wheel_wins w
                 where w.tenant_id = v_t and w.player_id = pl.id and w.redeemed) as redeemed,
               (jsonb_array_length(pl.flags) > 0) as flagged
          from players pl
         where pl.tenant_id = v_t and (p_search is null or pl.phone ilike '%' || p_search || '%')
         order by pl.created_at desc
         limit p_limit offset p_offset
      ) t), '[]'::jsonb)
  );
end $$;

create or replace function admin_player_detail(p_phone text)
returns jsonb language plpgsql as $$
declare v_t uuid := require_tenant(); v_player players%rowtype;
begin
  select * into v_player from players where tenant_id = v_t and phone = p_phone;
  if not found then return null; end if;

  return jsonb_build_object(
    'player', jsonb_build_object(
      'phone', v_player.phone, 'firstSeen', v_player.created_at, 'lastSeen', v_player.last_seen_at,
      'points', v_player.order_points, 'highScore', v_player.high_score, 'games', v_player.games,
      'flags', v_player.flags
    ),
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
                'score', r.score, 'at', r.created_at, 'suspicious', r.suspicious) order by r.created_at desc)
              from (select * from runs where tenant_id = v_t and player_id = v_player.id
                    order by created_at desc limit 20) r), '[]'::jsonb),
    'wins', coalesce((select jsonb_agg(jsonb_build_object(
                'prize', w.prize_label, 'score', w.score, 'at', w.created_at,
                'redeemed', w.redeemed, 'redeemedAt', w.redeemed_at, 'redeemedBy', w.redeemed_by, 'id', w.id)
                order by w.created_at desc)
              from wheel_wins w where w.tenant_id = v_t and w.player_id = v_player.id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object(
                'delta', l.delta, 'reason', l.reason, 'source', l.source, 'at', l.created_at) order by l.created_at desc)
              from (select * from points_ledger where tenant_id = v_t and player_id = v_player.id
                    order by created_at desc limit 20) l), '[]'::jsonb)
  );
end $$;

create or replace function admin_redemptions(
  p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 25, p_offset integer default 0
) returns jsonb language plpgsql as $$
declare v_t uuid := require_tenant(); v_total integer; v_redeemed integer;
begin
  select count(*) into v_total from wheel_wins w
   where w.tenant_id = v_t
     and (p_from is null or w.created_at >= p_from)
     and (p_to   is null or w.created_at <  p_to);
  select count(*) into v_redeemed from wheel_wins w
   where w.tenant_id = v_t and w.redeemed
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
                  where w.tenant_id = v_t
                    and (p_from is null or w.created_at >= p_from)
                    and (p_to   is null or w.created_at <  p_to)
                  group by 1
               ) t), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'phone', t.phone, 'prize', t.prize_label, 'score', t.score,
        'wonAt', t.created_at, 'redeemed', t.redeemed, 'redeemedAt', t.redeemed_at, 'redeemedBy', t.redeemed_by
      ) order by t.created_at desc)
      from (
        select w.id, p2.phone, w.prize_label, w.score, w.created_at, w.redeemed, w.redeemed_at, w.redeemed_by
          from wheel_wins w join players p2 on p2.tenant_id = w.tenant_id and p2.id = w.player_id
         where w.tenant_id = v_t
           and (p_from is null or w.created_at >= p_from)
           and (p_to   is null or w.created_at <  p_to)
         order by w.created_at desc
         limit p_limit offset p_offset
      ) t), '[]'::jsonb)
  );
end $$;

create or replace function admin_engagement(p_days integer default 14)
returns jsonb language plpgsql as $$
declare v_t uuid := require_tenant(); v_since timestamptz := now() - make_interval(days => p_days);
begin
  return jsonb_build_object(
    'playsPerDay', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'n', t.n) order by t.day)
                    from (select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day, count(*) as n
                          from runs where tenant_id = v_t and created_at > v_since group by 1) t), '[]'::jsonb),
    'scoreDist', coalesce((select jsonb_agg(jsonb_build_object('bucket', t.bucket, 'n', t.n) order by t.bucket)
                   from (select (score / 1000) * 1000 as bucket, count(*) as n
                         from runs where tenant_id = v_t and created_at > v_since and token_used
                         group by 1) t), '[]'::jsonb),
    'peakHours', coalesce((select jsonb_agg(jsonb_build_object('hour', t.hour, 'n', t.n) order by t.hour)
                   from (select extract(hour from created_at at time zone 'Africa/Cairo')::int as hour, count(*) as n
                         from runs where tenant_id = v_t and created_at > v_since group by 1) t), '[]'::jsonb),
    'winsPerDay', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'n', t.n) order by t.day)
                   from (select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day, count(*) as n
                         from wheel_wins where tenant_id = v_t and created_at > v_since group by 1) t), '[]'::jsonb),
    'redemptionsPerDay', coalesce((select jsonb_agg(jsonb_build_object('day', t.day, 'n', t.n) order by t.day)
                   from (select to_char(redeemed_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day, count(*) as n
                         from wheel_wins where tenant_id = v_t and redeemed and redeemed_at > v_since
                         group by 1) t), '[]'::jsonb),
    'dropOff', jsonb_build_object(
      'started',   (select count(*) from runs where tenant_id = v_t and created_at > v_since),
      'finished',  (select count(*) from runs where tenant_id = v_t and created_at > v_since and token_used),
      'abandoned', (select count(*) from runs
                     where tenant_id = v_t and created_at > v_since and not token_used
                       and created_at < now() - interval '15 minutes')
    )
  );
end $$;

create or replace function client_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql as $$
declare
  v_t     uuid        := require_tenant();
  v_pfrom timestamptz := p_from - (p_to - p_from);
  v_comm  numeric;
begin
  select coalesce((value)::numeric, 0) into v_comm from settings
   where tenant_id = v_t and key = 'commission_pct';

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'commissionPct', coalesce(v_comm, 0),
    'revenue',      coalesce((select sum(amount_egp) from points_ledger
                       where tenant_id = v_t and reason = 'order' and created_at >= p_from and created_at < p_to), 0),
    'revenuePrev',  coalesce((select sum(amount_egp) from points_ledger
                       where tenant_id = v_t and reason = 'order' and created_at >= v_pfrom and created_at < p_from), 0),
    'orders',       (select count(*) from points_ledger
                       where tenant_id = v_t and reason = 'order' and created_at >= p_from and created_at < p_to),
    'ordersPrev',   (select count(*) from points_ledger
                       where tenant_id = v_t and reason = 'order' and created_at >= v_pfrom and created_at < p_from),
    'codeUses',     (select count(*) from wheel_wins
                       where tenant_id = v_t and redeemed and redeemed_at >= p_from and redeemed_at < p_to),
    'codeUsesPrev', (select count(*) from wheel_wins
                       where tenant_id = v_t and redeemed and redeemed_at >= v_pfrom and redeemed_at < p_from),
    'newCustomers', (select count(*) from players
                       where tenant_id = v_t and created_at >= p_from and created_at < p_to),
    'winsInRange',     (select count(*) from wheel_wins
                          where tenant_id = v_t and created_at >= p_from and created_at < p_to),
    'redeemedInRange', (select count(*) from wheel_wins
                          where tenant_id = v_t and redeemed and redeemed_at >= p_from and redeemed_at < p_to),
    'series', coalesce((select jsonb_agg(jsonb_build_object(
                  'day', t.day, 'revenue', t.rev, 'orders', t.n) order by t.day)
                from (select to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day,
                             coalesce(sum(amount_egp), 0) as rev, count(*) as n
                        from points_ledger
                       where tenant_id = v_t and reason = 'order' and created_at >= p_from and created_at < p_to
                       group by 1) t), '[]'::jsonb),
    'topRewards', coalesce((select jsonb_agg(jsonb_build_object('label', t.prize_label, 'n', t.n) order by t.n desc)
                    from (select prize_label, count(*) as n from wheel_wins
                           where tenant_id = v_t and redeemed and redeemed_at >= p_from and redeemed_at < p_to
                           group by 1 order by 2 desc limit 6) t), '[]'::jsonb),
    'recentOrders', coalesce((select jsonb_agg(jsonb_build_object(
                       'phone', t.phone, 'amount', t.amount_egp, 'at', t.created_at) order by t.created_at desc)
                     from (select p2.phone, l.amount_egp, l.created_at
                             from points_ledger l join players p2 on p2.tenant_id = l.tenant_id and p2.id = l.player_id
                            where l.tenant_id = v_t and l.reason = 'order'
                              and l.created_at >= p_from and l.created_at < p_to
                            order by l.created_at desc limit 12) t), '[]'::jsonb)
  );
end $$;

commit;
