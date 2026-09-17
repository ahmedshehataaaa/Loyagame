-- ============================================================
-- 0004 — Database roles and Row-Level Security (ADR 0018).
--
-- WHY NEW ROLES. Until now every function reached PostgREST with the
-- service key, and the service role BYPASSES RLS. Policies keyed on
-- tenant_id would therefore have isolated nothing on the real code
-- path. Request traffic now uses roles that cannot bypass RLS:
--
--   app_tenant       one tenant's player + brand-admin traffic. JWT
--                    carries {role:"app_tenant", tenant_id}.
--   ops_admin        ClaimLabs staff: tenant CRUD, publishing, the
--                    cross-tenant overview.
--   tenant_resolver  can do exactly one thing: look a tenant up by
--                    slug, so the API can decide which tenant JWT to
--                    mint.
--
-- Tokens for all three are minted server-side per request
-- (lib/db.mjs) with a 60-second expiry and never reach a browser.
-- ============================================================
begin;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_tenant') then
    create role app_tenant nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'ops_admin') then
    create role ops_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tenant_resolver') then
    create role tenant_resolver nologin noinherit;
  end if;
  -- PostgREST connects as `authenticator` and switches to the JWT's role, which
  -- it may only do for roles it is a member of.
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant app_tenant, ops_admin, tenant_resolver to authenticator;
  end if;
end $$;

-- ---- table privileges (least privilege; RLS narrows rows further) -----------
grant usage on schema public to app_tenant, ops_admin, tenant_resolver;
grant usage on all sequences in schema public to app_tenant, ops_admin;

grant select, insert, update on players, runs, wheel_wins to app_tenant;
grant select, insert         on points_ledger           to app_tenant;
grant select                 on settings, tenants       to app_tenant;

grant select on players, points_ledger, runs, wheel_wins, settings,
                tenants, tenant_config_versions, tenant_events, reward_presets to ops_admin;
grant insert, update on settings, tenants, tenant_config_versions, reward_presets to ops_admin;
grant insert on tenant_events to ops_admin;

-- Supabase grants its client roles broad table privileges by default. RLS with
-- no policies already denies them every row; revoking says so explicitly.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on players, points_ledger, runs, wheel_wins, settings, tenants, '
        'tenant_config_versions, tenant_events, reward_presets from %I', r);
    end if;
  end loop;
end $$;

-- ---- policies ------------------------------------------------------------------
do $$
declare v_tbl text;
begin
  foreach v_tbl in array array['players', 'points_ledger', 'runs', 'wheel_wins', 'settings'] loop
    execute format('alter table %I enable row level security', v_tbl);

    execute format('drop policy if exists tenant_isolation_select on %I', v_tbl);
    execute format('create policy tenant_isolation_select on %I for select to app_tenant
                    using (tenant_id = current_tenant())', v_tbl);

    execute format('drop policy if exists tenant_isolation_insert on %I', v_tbl);
    execute format('create policy tenant_isolation_insert on %I for insert to app_tenant
                    with check (tenant_id = current_tenant())', v_tbl);

    execute format('drop policy if exists tenant_isolation_update on %I', v_tbl);
    execute format('create policy tenant_isolation_update on %I for update to app_tenant
                    using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())', v_tbl);

    -- The cross-tenant ops view reads everything; it writes nothing here
    -- except settings (below), and only through ops_* functions.
    execute format('drop policy if exists ops_read_all on %I', v_tbl);
    execute format('create policy ops_read_all on %I for select to ops_admin using (true)', v_tbl);
  end loop;
end $$;

drop policy if exists ops_write_settings on settings;
create policy ops_write_settings on settings for insert to ops_admin with check (true);
drop policy if exists ops_update_settings on settings;
create policy ops_update_settings on settings for update to ops_admin using (true) with check (true);

alter table tenants                enable row level security;
alter table tenant_config_versions enable row level security;
alter table tenant_events          enable row level security;
alter table reward_presets         enable row level security;

drop policy if exists tenant_self_read on tenants;
create policy tenant_self_read on tenants for select to app_tenant using (id = current_tenant());

drop policy if exists ops_all on tenants;
create policy ops_all on tenants for all to ops_admin using (true) with check (true);
drop policy if exists ops_all on tenant_config_versions;
create policy ops_all on tenant_config_versions for all to ops_admin using (true) with check (true);
drop policy if exists ops_all on tenant_events;
create policy ops_all on tenant_events for all to ops_admin using (true) with check (true);
drop policy if exists ops_all on reward_presets;
create policy ops_all on reward_presets for all to ops_admin using (true) with check (true);

-- ---- tenant lookup (the only SECURITY DEFINER surface) ------------------------
-- Needed BEFORE a tenant JWT can exist, so it cannot rely on RLS. It returns
-- one row by exact slug, exposes no data rows, and is executable only by
-- tenant_resolver. The key hashes are for the server's constant-time check.
create or replace function resolve_tenant(p_slug text)
returns table (id uuid, slug text, name text, status tenant_status, game_format game_format,
               published boolean, admin_key_hash text, pos_secret_hash text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.slug, t.name, t.status, t.game_format, t.brand_config is not null,
         t.admin_key_hash, t.pos_secret_hash
    from tenants t
   where t.slug = p_slug
$$;

-- The published manifest a player's browser boots from. Public by nature:
-- it is brand copy, sprite URLs and prize labels the game shows anyway.
create or replace function tenant_published_config(p_slug text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('slug', t.slug, 'name', t.name, 'status', t.status,
                            'gameFormat', t.game_format, 'manifest', t.brand_config)
    from tenants t
   where t.slug = p_slug and t.status in ('trial', 'active') and t.brand_config is not null
$$;

-- ---- function privileges ----------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default, and Supabase adds its client
-- roles. Revoked per function (not "all functions in schema"), so extension
-- functions such as pgcrypto's gen_random_bytes keep their normal grants.
do $$
declare
  fn text;
  v_ours constant text[] := array[
    'current_tenant()', 'require_tenant()', 'require_live_tenant()',
    'credit_order_points(text,text,integer,text,text,numeric)',
    'check_eligibility(text,text,integer,integer,integer)',
    'start_play(text,text,text,integer,integer,integer,text)',
    'mint_coupon_code(text)',
    'resolve_run(uuid,integer,integer,text,integer,integer,integer,jsonb,boolean)',
    'redeem_wheel_win(bigint,text)',
    'admin_dashboard(text,integer,integer)',
    'admin_players_list(text,integer,integer)',
    'admin_player_detail(text)',
    'admin_redemptions(timestamptz,timestamptz,integer,integer)',
    'admin_engagement(integer)',
    'client_dashboard(timestamptz,timestamptz)',
    'reward_tiers_valid(jsonb)',
    'resolve_tenant(text)',
    'tenant_published_config(text)'
  ];
begin
  foreach fn in array v_ours loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', fn);
    end if;
  end loop;
end $$;

grant execute on function current_tenant(), require_tenant(), require_live_tenant()
  to app_tenant, ops_admin;
grant execute on function
  credit_order_points(text,text,integer,text,text,numeric),
  check_eligibility(text,text,integer,integer,integer),
  start_play(text,text,text,integer,integer,integer,text),
  mint_coupon_code(text),
  resolve_run(uuid,integer,integer,text,integer,integer,integer,jsonb,boolean),
  redeem_wheel_win(bigint,text),
  admin_dashboard(text,integer,integer),
  admin_players_list(text,integer,integer),
  admin_player_detail(text),
  admin_redemptions(timestamptz,timestamptz,integer,integer),
  admin_engagement(integer),
  client_dashboard(timestamptz,timestamptz)
  to app_tenant;
grant execute on function reward_tiers_valid(jsonb) to ops_admin;
grant execute on function resolve_tenant(text), tenant_published_config(text) to tenant_resolver;

commit;
