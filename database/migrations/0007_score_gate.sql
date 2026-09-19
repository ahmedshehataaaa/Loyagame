-- ============================================================
-- 0007 — A per-tenant win gate: order points (default) or round score.
--
-- Until now every tenant's wheel was gated on ORDER POINTS, which only a POS
-- webhook can credit. A tenant with no POS integration (Jimmy's Pizzeria runs
-- on a Zyda storefront) therefore had a wheel no player could ever reach:
-- players scored 4,000 in the game, saw nothing happen, and reasonably
-- concluded the backend was not saving anything.
--
-- `settings.wheel_gate` picks the rule per tenant:
--   'order_points' — unchanged: survive + hold wheel_points_threshold order
--                    points, which the spin spends.
--   'score'        — survive + score at least wheel_points_threshold in that
--                    round. Nothing is spent; the existing win lockout
--                    (settings.win_lockout_hrs, enforced by start_play) is what
--                    stops one phone collecting a prize every round.
-- Anything else, or no row, is 'order_points': the stricter rule is the
-- fallback, so a typo can never open a wheel.
--
-- The gate is a settings row, not a manifest field, because ops_publish_version
-- rewrites the manifest's rewards block from a reviewed preset on every
-- publish, and a gate stored there would silently revert. The public config
-- endpoint merges it into rewards.gate so the game's copy can say "score" or
-- "order points" before a round is played.
-- ============================================================
begin;

drop function if exists resolve_run(uuid, integer, integer, text, integer, integer, integer, jsonb, boolean);
create or replace function resolve_run(
  p_token uuid, p_score integer, p_duration integer, p_device text,
  p_points_threshold integer, p_min_ms integer, p_max_score integer, p_prizes jsonb,
  p_survived boolean, p_gate text default 'order_points'
) returns table (ok boolean, won boolean, prize jsonb, suspicious boolean, gap integer,
                 order_points integer, code text, expires_at timestamptz)
language plpgsql as $$
declare
  v_tenant uuid := require_live_tenant();
  v_run runs%rowtype; v_elapsed_ms numeric; v_susp boolean := false;
  v_total numeric := 0; v_r numeric; v_acc numeric := 0; v_prize jsonb; elem jsonb;
  v_points integer := 0; v_code text; v_expires timestamptz; v_prefix text;
  v_by_score boolean := coalesce(p_gate, '') = 'score';
  v_have integer;
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

  -- What is measured against the threshold: this round's score, or the balance.
  v_have := case when v_by_score then coalesce(p_score, 0) else v_points end;

  if coalesce(p_survived, false) and v_have >= p_points_threshold and not v_susp then
    if not v_by_score then
      insert into points_ledger (tenant_id, player_id, delta, reason, source, note)
      values (v_tenant, v_run.player_id, -p_points_threshold, 'wheel_spend', 'manual', 'wheel spin spend');
    end if;

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
    gap := greatest(0, p_points_threshold - v_have);
    order_points := v_points; code := null; expires_at := null;
  end if;
  return next;
end $$;

revoke execute on function resolve_run(uuid,integer,integer,text,integer,integer,integer,jsonb,boolean,text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function resolve_run(uuid,integer,integer,text,integer,integer,integer,jsonb,boolean,text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function resolve_run(uuid,integer,integer,text,integer,integer,integer,jsonb,boolean,text) from authenticated;
  end if;
end $$;
grant execute on function resolve_run(uuid,integer,integer,text,integer,integer,integer,jsonb,boolean,text)
  to app_tenant;

-- The public manifest carries the gate, so the game can word its copy for it.
create or replace function tenant_published_config(p_slug text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('slug', t.slug, 'name', t.name, 'status', t.status,
                            'gameFormat', t.game_format,
                            'manifest', case
                              when t.brand_config ? 'rewards' then
                                jsonb_set(t.brand_config, '{rewards,gate}',
                                          case when g.value = '"score"'::jsonb then g.value
                                               else '"order_points"'::jsonb end)
                              else t.brand_config end)
    from tenants t
    left join settings g on g.tenant_id = t.id and g.key = 'wheel_gate'
   where t.slug = p_slug and t.status in ('trial', 'active') and t.brand_config is not null
$$;

commit;
