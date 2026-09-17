-- ============================================================
-- 0001 — Tenancy core (ADR 0018).
--
-- New tables only: tenants, reviewed reward presets, config
-- versions (draft -> preview -> publish) and an audit trail. No
-- existing table is touched here, so this file is safe on a live
-- instance on its own. Applied after supabase/schema.sql, by
-- scripts/db-migrate.mjs.
-- ============================================================
begin;

create extension if not exists pgcrypto;

do $$ begin
  create type tenant_status as enum ('trial', 'active', 'paused', 'archived');
exception when duplicate_object then null; end $$;

-- catch_fries is declared so the data model does not need a second migration
-- when that engine exists. It does not exist yet, and ops_create_tenant()
-- refuses it (CLAUDE.md: do not build or reference it unprompted).
do $$ begin
  create type game_format as enum ('slice_rush', 'catch_fries');
exception when duplicate_object then null; end $$;

-- ---- reward presets ------------------------------------------------------
-- Prize ladders ClaimLabs has REVIEWED. The onboarding wizard can pick a
-- reviewed preset and rename its product tiers into the client's menu; it can
-- never set odds or a points threshold. Odds are real-money exposure under an
-- open compliance flag (docs/security/reward-wheel-compliance.md), so they
-- change by migration plus a named review, never by a form field.
create or replace function reward_tiers_valid(p_tiers jsonb) returns boolean
language plpgsql immutable as $$
declare elem jsonb; v_keys text[] := '{}';
begin
  if coalesce(jsonb_typeof(p_tiers), '') <> 'array' or jsonb_array_length(p_tiers) = 0 then
    return false;
  end if;
  for elem in select * from jsonb_array_elements(p_tiers) loop
    if coalesce(jsonb_typeof(elem), '') <> 'object' then return false; end if;
    if coalesce(elem->>'key', '') !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then return false; end if;
    if (elem->>'key') = any (v_keys) then return false; end if;
    v_keys := v_keys || (elem->>'key');
    -- A missing weight must fail too: jsonb_typeof(null) is null, and a bare
    -- `<> 'number'` on null would quietly pass.
    if coalesce(jsonb_typeof(elem->'weight'), '') <> 'number' then return false; end if;
    if (elem->>'weight')::numeric <= 0 then return false; end if;
    if coalesce(elem->>'valueClass', '') = '' or coalesce(elem->>'defaultLabel', '') = '' then
      return false;
    end if;
  end loop;
  return true;
end $$;

create table if not exists reward_presets (
  id               text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name             text not null,
  description      text not null default '',
  points_threshold integer not null check (points_threshold > 0),
  -- [{key, weight, valueClass, defaultLabel, labelEditable?}]
  tiers            jsonb not null check (reward_tiers_valid(tiers)),
  status           text not null default 'draft'
                   check (status in ('draft', 'reviewed', 'retired')),
  reviewed_by      text,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint reward_presets_review_recorded check (
    status <> 'reviewed' or (coalesce(btrim(reviewed_by), '') <> '' and reviewed_at is not null)
  )
);

-- A reviewed ladder is a signed-off fact. Changing its odds in place would
-- keep the reviewer's name on numbers they never saw, so it is refused:
-- a changed ladder is a new preset with its own review.
create or replace function reward_presets_lock() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (
       new.tiers is distinct from old.tiers
    or new.points_threshold is distinct from old.points_threshold
  ) then
    raise exception 'preset_locked: % is % and its odds cannot change', old.id, old.status
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists reward_presets_lock on reward_presets;
create trigger reward_presets_lock before update on reward_presets
  for each row execute function reward_presets_lock();

-- The McDonald's launch ladder, generalised into value classes. Seeded as a
-- DRAFT on purpose: nobody has reviewed it as a reusable preset, and recording
-- a review here would fabricate one. A named person reviews it from the ops
-- dashboard (ops_review_preset) before the wizard can offer it.
-- Percentage tiers are not relabelable — "5% off" renamed to "50% off" would
-- change the prize value while keeping the reviewed weight.
insert into reward_presets (id, name, description, points_threshold, tiers) values (
  'standard-10',
  'Standard 10-tier ladder',
  'The McDonald''s launch ladder: frequent low-value prizes, rare high-value ones. Weights sum to 100.',
  4000,
  '[
    {"key":"off5",      "weight":28,  "valueClass":"5% off the order",    "defaultLabel":"5% off your order",   "labelEditable":false},
    {"key":"side1",     "weight":20,  "valueClass":"Free small side",     "defaultLabel":"Free small side"},
    {"key":"off10",     "weight":18,  "valueClass":"10% off the order",   "defaultLabel":"10% off your order",  "labelEditable":false},
    {"key":"side2",     "weight":12,  "valueClass":"Free small side",     "defaultLabel":"Free small side"},
    {"key":"medium",    "weight":9,   "valueClass":"Free medium item",    "defaultLabel":"Free medium item"},
    {"key":"off15",     "weight":6,   "valueClass":"15% off the order",   "defaultLabel":"15% off your order",  "labelEditable":false},
    {"key":"dessert",   "weight":4,   "valueClass":"Free dessert",        "defaultLabel":"Free dessert"},
    {"key":"off20",     "weight":2,   "valueClass":"20% off the order",   "defaultLabel":"20% off your order",  "labelEditable":false},
    {"key":"signature", "weight":0.8, "valueClass":"Free signature main", "defaultLabel":"Free signature main"},
    {"key":"off25",     "weight":0.2, "valueClass":"25% off the order",   "defaultLabel":"25% off your order",  "labelEditable":false}
  ]'::jsonb
) on conflict (id) do nothing;

-- ---- tenants ---------------------------------------------------------------
create table if not exists tenants (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(btrim(name)) between 1 and 80),
  -- Same rule as brand.id in src/campaign/schema.js: it becomes a URL segment
  -- and a localStorage namespace.
  slug                 text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  status               tenant_status not null default 'trial',
  game_format          game_format not null default 'slice_rush',
  coupon_prefix        text not null check (coupon_prefix ~ '^[A-Z]{2,4}$'),
  -- The PUBLISHED manifest. Null until the first publish; a tenant with no
  -- published config is not playable.
  brand_config         jsonb,
  reward_preset_id     text references reward_presets (id),
  published_version_id bigint,
  -- sha256 hex of per-tenant secrets. Plaintext is shown once at rotation and
  -- never stored.
  admin_key_hash       text check (admin_key_hash ~ '^[0-9a-f]{64}$'),
  pos_secret_hash      text check (pos_secret_hash ~ '^[0-9a-f]{64}$'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---- config versions -------------------------------------------------------
create table if not exists tenant_config_versions (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null references tenants (id) on delete cascade,
  -- Brand, items, hazard, rules. Its `rewards` block is IGNORED: publish
  -- recomposes rewards from the reviewed preset + labels below.
  manifest         jsonb not null,
  reward_preset_id text not null references reward_presets (id),
  prize_labels     jsonb not null default '{}'::jsonb,
  state            text not null default 'draft'
                   check (state in ('draft', 'published', 'superseded')),
  created_by       text not null,
  created_at       timestamptz not null default now(),
  published_by     text,
  published_at     timestamptz
);
create unique index if not exists tenant_config_one_published
  on tenant_config_versions (tenant_id) where state = 'published';
create index if not exists tenant_config_versions_tenant_idx
  on tenant_config_versions (tenant_id, created_at desc);

-- ---- audit trail -----------------------------------------------------------
create table if not exists tenant_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references tenants (id) on delete cascade,
  action     text not null,
  actor      text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tenant_events_tenant_idx on tenant_events (tenant_id, created_at desc);

commit;
