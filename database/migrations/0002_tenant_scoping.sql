-- ============================================================
-- 0002 — Put every tenant-scoped row under a tenant (ADR 0018).
--
-- 1. current_tenant(): the tenant a request acts for, read from the
--    JWT claims PostgREST verified. Never a function argument, so a
--    caller cannot name someone else's tenant.
-- 2. The McDonald's tenant, with a FIXED id so code and docs can
--    name it.
-- 3. Backfill: tag every existing row as McDonald's, and PROVE it —
--    row count and a content checksum per table are taken before and
--    after, and any difference aborts the whole transaction.
-- 4. Tenant-aware uniqueness and composite foreign keys, so a row
--    cannot reference another tenant's player even from buggy code.
-- ============================================================
begin;

create or replace function current_tenant() returns uuid
language plpgsql stable as $$
declare v_claims text := current_setting('request.jwt.claims', true); v_id text;
begin
  if coalesce(v_claims, '') <> '' then
    v_id := v_claims::jsonb ->> 'tenant_id';
    if coalesce(v_id, '') <> '' then
      return v_id::uuid; -- a malformed id raises: fail closed
    end if;
  end if;
  -- TRANSITION ONLY. Before this migration the functions reached the database
  -- with the service key and no tenant at all. Mapping those callers onto the
  -- McDonald's tenant keeps a deployment that has the new schema but not yet
  -- the new functions working, instead of taking the live game down between
  -- the two steps. These roles bypass RLS anyway, so this grants nothing new.
  -- Remove once lib/db.mjs has shipped everywhere (ADR 0018, "Follow-up").
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return '00000000-0000-4000-8000-000000000001'::uuid;
  end if;
  return null;
end $$;

create or replace function require_tenant() returns uuid
language plpgsql stable as $$
declare v uuid := current_tenant();
begin
  if v is null then
    raise exception 'tenant_required' using errcode = '42501';
  end if;
  return v;
end $$;

-- Player-facing money paths also require the tenant to be live. A paused or
-- archived campaign keeps its data readable but cannot start or pay a round.
create or replace function require_live_tenant() returns uuid
language plpgsql stable as $$
declare v uuid := require_tenant(); v_status tenant_status;
begin
  select t.status into v_status from tenants t where t.id = v;
  if v_status is null or v_status not in ('trial', 'active') then
    raise exception 'tenant_inactive' using errcode = '42501';
  end if;
  return v;
end $$;

-- The existing single-tenant data is McDonald's. brand_config stays null: the
-- McDonald's game boots from its built-in config at the site root, exactly as
-- before, and only a tenant onboarded through the ops dashboard is served
-- from /play/<slug>/.
insert into tenants (id, name, slug, status, game_format, coupon_prefix)
values ('00000000-0000-4000-8000-000000000001', 'McDonald''s', 'mcdonalds', 'active',
        'slice_rush', 'MC')
on conflict (id) do nothing;

-- ---- backfill, with proof ----------------------------------------------------
do $$
declare
  v_legacy constant uuid := '00000000-0000-4000-8000-000000000001';
  v_tbl text; v_order text;
  v_rows_before bigint; v_rows_after bigint;
  v_sum_before text; v_sum_after text; v_untagged bigint;
  v_snapshot constant text :=
    $q$select count(*), coalesce(md5(string_agg((to_jsonb(t) - 'tenant_id')::text, '|' order by t.%I)), '')
         from %I t$q$;
begin
  foreach v_tbl in array array['players', 'points_ledger', 'runs', 'wheel_wins', 'settings'] loop
    v_order := case v_tbl when 'settings' then 'key' else 'id' end;

    execute format('alter table %I add column if not exists tenant_id uuid references tenants (id)', v_tbl);

    execute format(v_snapshot, v_order, v_tbl) into v_rows_before, v_sum_before;
    execute format('update %I set tenant_id = $1 where tenant_id is null', v_tbl) using v_legacy;
    execute format(v_snapshot, v_order, v_tbl) into v_rows_after, v_sum_after;
    execute format('select count(*) from %I where tenant_id is null', v_tbl) into v_untagged;

    if v_rows_before <> v_rows_after or v_sum_before <> v_sum_after or v_untagged <> 0 then
      raise exception 'backfill check failed on %: rows % -> %, checksum % -> %, untagged %',
        v_tbl, v_rows_before, v_rows_after, v_sum_before, v_sum_after, v_untagged;
    end if;
    raise notice 'backfill %: % rows, checksum % unchanged, 0 untagged', v_tbl, v_rows_after, v_sum_after;

    execute format('alter table %I alter column tenant_id set not null', v_tbl);
    -- Inserts that omit tenant_id take the caller's tenant. With no tenant in
    -- the claims the default is null and the NOT NULL above rejects the row.
    execute format('alter table %I alter column tenant_id set default current_tenant()', v_tbl);
  end loop;
end $$;

-- ---- tenant-aware keys -------------------------------------------------------
-- Foreign keys first: they depend on the keys being replaced below.
alter table points_ledger drop constraint if exists points_ledger_player_id_fkey;
alter table points_ledger drop constraint if exists points_ledger_tenant_player_fkey;
alter table runs          drop constraint if exists runs_player_id_fkey;
alter table runs          drop constraint if exists runs_tenant_player_fkey;
alter table wheel_wins    drop constraint if exists wheel_wins_player_id_fkey;
alter table wheel_wins    drop constraint if exists wheel_wins_tenant_player_fkey;

-- One phone is one player PER BRAND. The same person playing two brands is two
-- separate players with separate points, limits and coupons.
alter table players drop constraint if exists players_phone_key;
alter table players drop constraint if exists players_tenant_phone_key;
alter table players add constraint players_tenant_phone_key unique (tenant_id, phone);
alter table players drop constraint if exists players_tenant_id_key;
alter table players add constraint players_tenant_id_key unique (tenant_id, id);

alter table points_ledger add constraint points_ledger_tenant_player_fkey
  foreign key (tenant_id, player_id) references players (tenant_id, id) on delete cascade;
alter table runs add constraint runs_tenant_player_fkey
  foreign key (tenant_id, player_id) references players (tenant_id, id) on delete cascade;
alter table wheel_wins add constraint wheel_wins_tenant_player_fkey
  foreign key (tenant_id, player_id) references players (tenant_id, id) on delete cascade;

-- POS order ids are only unique within one restaurant's till system.
drop index if exists points_ledger_order_uniq;
create unique index if not exists points_ledger_tenant_order_uniq
  on points_ledger (tenant_id, order_id) where order_id is not null;

-- Coupon codes and round tokens stay GLOBALLY unique: both are bearer tokens,
-- and a code valid at two brands would be a code two brands' staff could honour.

alter table settings drop constraint if exists settings_pkey;
alter table settings add constraint settings_pkey primary key (tenant_id, key);

create index if not exists players_tenant_created_idx      on players (tenant_id, created_at desc);
create index if not exists points_ledger_tenant_player_idx on points_ledger (tenant_id, player_id, created_at desc);
create index if not exists points_ledger_tenant_created_idx on points_ledger (tenant_id, created_at) where reason = 'order';
create index if not exists runs_tenant_created_idx         on runs (tenant_id, created_at desc);
create index if not exists runs_tenant_device_idx          on runs (tenant_id, device_id, created_at desc);
create index if not exists wheel_wins_tenant_created_idx   on wheel_wins (tenant_id, created_at desc);
create index if not exists wheel_wins_tenant_device_idx    on wheel_wins (tenant_id, device_id, created_at desc);

commit;
