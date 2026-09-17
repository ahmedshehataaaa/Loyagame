-- ============================================================
-- 0005 — ClaimLabs ops functions (ADR 0018).
--
-- Everything the onboarding wizard and tenant management do, as
-- row-locked functions executable only by ops_admin. The dashboard
-- never writes a table directly.
--
-- Errors are raised with a machine-readable message (`slug_reserved`,
-- `preset_not_reviewed`, ...) that api/ops-tenants.mjs passes back to
-- the dashboard verbatim.
-- ============================================================
begin;

create or replace function ops_require_actor(p_actor text) returns text
language plpgsql immutable as $$
begin
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'actor_required' using errcode = '22023';
  end if;
  return btrim(p_actor);
end $$;

-- Rewards = a reviewed preset's odds + the client's product names for the
-- relabelable tiers. The ONLY place a prize list is composed, used by both
-- preview and publish so the two cannot disagree.
create or replace function compose_rewards(p_preset_id text, p_labels jsonb)
returns jsonb language plpgsql stable as $$
declare v_preset reward_presets%rowtype; elem jsonb; v_label text; v_prizes jsonb := '[]'::jsonb;
begin
  select * into v_preset from reward_presets where id = p_preset_id;
  if not found then
    raise exception 'preset_not_found' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_labels), '') <> 'object' then
    raise exception 'invalid_prize_labels' using errcode = '22023';
  end if;
  for elem in select * from jsonb_array_elements(v_preset.tiers) loop
    if coalesce((elem->>'labelEditable')::boolean, true) then
      v_label := btrim(coalesce(p_labels->>(elem->>'key'), ''));
      if v_label = '' then
        raise exception 'prize_label_missing:%', elem->>'key' using errcode = '22023';
      end if;
      if length(v_label) > 60 then
        raise exception 'prize_label_too_long:%', elem->>'key' using errcode = '22023';
      end if;
    else
      v_label := elem->>'defaultLabel';
    end if;
    v_prizes := v_prizes || jsonb_build_array(
      jsonb_build_object('key', elem->>'key', 'label', v_label, 'weight', elem->'weight'));
  end loop;
  return jsonb_build_object('pointsThreshold', v_preset.points_threshold, 'prizes', v_prizes);
end $$;

-- ---- create ------------------------------------------------------------------
create or replace function ops_create_tenant(
  p_name text, p_slug text, p_game_format game_format, p_coupon_prefix text, p_actor text
) returns jsonb language plpgsql as $$
declare v_actor text := ops_require_actor(p_actor); v tenants%rowtype;
begin
  if p_game_format <> 'slice_rush' then
    raise exception 'game_format_unavailable' using errcode = '22023';
  end if;
  -- Slugs become /play/<slug>/ and must never shadow a real path.
  if p_slug = any (array['api', 'assets', 'src', 'engine', 'play', 'admin', 'ops', 'campaigns',
                         'static', 'dist', 'lib', 'netlify', 'supabase', 'database', 'www', 'app']) then
    raise exception 'slug_reserved' using errcode = '22023';
  end if;
  if exists (select 1 from tenants where slug = p_slug) then
    raise exception 'slug_taken' using errcode = '23505';
  end if;

  insert into tenants (name, slug, game_format, coupon_prefix)
  values (btrim(p_name), p_slug, p_game_format, upper(btrim(p_coupon_prefix)))
  returning * into v;

  -- The same defaults supabase/schema.sql seeded for the first client. Prize
  -- settings are deliberately absent: they are written by publish, from a
  -- reviewed preset, and a tenant with none cannot pay out.
  insert into settings (tenant_id, key, value)
  select v.id, s.key, s.value::jsonb from (values
    ('points_per_egp', '1'), ('max_plausible_score', '2000000'), ('min_run_ms', '5000'),
    ('max_runs_per_hour', '40'), ('max_plays', '999999'), ('play_window_hrs', '24'),
    ('win_lockout_hrs', '12'), ('commission_pct', '0'), ('currency', '"EGP"'),
    ('round_time_sec', '30'), ('survival_tolerance', '0.95')
  ) as s(key, value);

  insert into tenant_events (tenant_id, action, actor, detail)
  values (v.id, 'created', v_actor, jsonb_build_object('slug', v.slug, 'gameFormat', v.game_format));

  return jsonb_build_object('id', v.id, 'slug', v.slug, 'name', v.name, 'status', v.status);
end $$;

-- ---- draft -------------------------------------------------------------------
create or replace function ops_save_draft(
  p_tenant_id uuid, p_manifest jsonb, p_reward_preset_id text, p_prize_labels jsonb, p_actor text
) returns jsonb language plpgsql as $$
declare v_actor text := ops_require_actor(p_actor); v_tenant tenants%rowtype; v_id bigint;
begin
  select * into v_tenant from tenants where id = p_tenant_id for update;
  if not found or v_tenant.status = 'archived' then
    raise exception 'tenant_not_found' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_manifest), '') <> 'object' then
    raise exception 'invalid_manifest' using errcode = '22023';
  end if;
  -- brand.id namespaces the player's local storage; it must be the slug.
  if p_manifest->'brand'->>'id' is distinct from v_tenant.slug then
    raise exception 'manifest_brand_mismatch' using errcode = '22023';
  end if;
  -- Validates the preset exists and every relabelable tier is named.
  perform compose_rewards(p_reward_preset_id, p_prize_labels);

  update tenant_config_versions set state = 'superseded'
   where tenant_id = p_tenant_id and state = 'draft';

  insert into tenant_config_versions (tenant_id, manifest, reward_preset_id, prize_labels, created_by)
  values (p_tenant_id, p_manifest - 'rewards', p_reward_preset_id, p_prize_labels, v_actor)
  returning id into v_id;

  insert into tenant_events (tenant_id, action, actor, detail)
  values (p_tenant_id, 'draft_saved', v_actor, jsonb_build_object('versionId', v_id));

  return jsonb_build_object('versionId', v_id);
end $$;

-- The manifest a preview renders: the draft plus composed rewards. Works on an
-- unreviewed preset (staff need to see a ladder before signing it off);
-- publishing is what requires the review.
create or replace function ops_version_manifest(p_version_id bigint)
returns jsonb language plpgsql stable as $$
declare v tenant_config_versions%rowtype;
begin
  select * into v from tenant_config_versions where id = p_version_id;
  if not found then
    raise exception 'version_not_found' using errcode = '22023';
  end if;
  return v.manifest || jsonb_build_object('rewards', compose_rewards(v.reward_preset_id, v.prize_labels));
end $$;

-- ---- publish -----------------------------------------------------------------
create or replace function ops_publish_version(p_version_id bigint, p_actor text)
returns jsonb language plpgsql as $$
declare
  v_actor text := ops_require_actor(p_actor);
  v_ver tenant_config_versions%rowtype; v_tenant tenants%rowtype; v_status text;
  v_rewards jsonb; v_round numeric;
begin
  select * into v_ver from tenant_config_versions where id = p_version_id for update;
  if not found then
    raise exception 'version_not_found' using errcode = '22023';
  end if;
  if v_ver.state <> 'draft' then
    raise exception 'version_not_draft' using errcode = '22023';
  end if;

  select * into v_tenant from tenants where id = v_ver.tenant_id for update;
  if v_tenant.status = 'archived' then
    raise exception 'tenant_archived' using errcode = '22023';
  end if;

  select status into v_status from reward_presets where id = v_ver.reward_preset_id;
  if v_status is distinct from 'reviewed' then
    raise exception 'preset_not_reviewed' using errcode = '22023';
  end if;

  v_rewards := compose_rewards(v_ver.reward_preset_id, v_ver.prize_labels);

  -- submit-run derives survival from settings.round_time_sec. A manifest
  -- round length that disagreed with it would make every full round of a
  -- 45-second campaign look like a loss, or a 20-second one look survivable.
  begin
    v_round := (v_ver.manifest->'rules'->>'roundSeconds')::numeric;
  exception when others then
    v_round := null;
  end;
  if v_round is null or v_round < 5 or v_round > 300 then
    raise exception 'invalid_round_seconds' using errcode = '22023';
  end if;

  update tenant_config_versions set state = 'superseded'
   where tenant_id = v_tenant.id and state = 'published';
  update tenant_config_versions
     set state = 'published', published_by = v_actor, published_at = now()
   where id = p_version_id;

  update tenants
     set brand_config = v_ver.manifest || jsonb_build_object('rewards', v_rewards),
         reward_preset_id = v_ver.reward_preset_id,
         published_version_id = p_version_id,
         updated_at = now()
   where id = v_tenant.id;

  -- The server-authoritative copy submit-run actually draws from.
  insert into settings (tenant_id, key, value) values
    (v_tenant.id, 'wheel_prizes', v_rewards->'prizes'),
    (v_tenant.id, 'wheel_points_threshold', v_rewards->'pointsThreshold'),
    (v_tenant.id, 'round_time_sec', to_jsonb(v_round))
  on conflict (tenant_id, key) do update set value = excluded.value;

  insert into tenant_events (tenant_id, action, actor, detail)
  values (v_tenant.id, 'published', v_actor,
          jsonb_build_object('versionId', p_version_id, 'presetId', v_ver.reward_preset_id));

  return jsonb_build_object('tenantId', v_tenant.id, 'versionId', p_version_id);
end $$;

-- ---- status ------------------------------------------------------------------
create or replace function ops_set_tenant_status(p_tenant_id uuid, p_status tenant_status, p_actor text)
returns jsonb language plpgsql as $$
declare v_actor text := ops_require_actor(p_actor); v tenants%rowtype;
begin
  select * into v from tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'tenant_not_found' using errcode = '22023';
  end if;
  if v.status = p_status then
    return jsonb_build_object('id', v.id, 'status', v.status);
  end if;
  -- Coming back from the archive is deliberate and lands paused, so a revived
  -- tenant is never live again by accident.
  if v.status = 'archived' and p_status <> 'paused' then
    raise exception 'archived_tenant_must_be_paused_first' using errcode = '22023';
  end if;
  -- The McDonald's tenant plays from the built-in config at the site root and
  -- has no published manifest by design (0002).
  if p_status = 'active' and v.brand_config is null
     and v.id <> '00000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'not_published' using errcode = '22023';
  end if;

  update tenants set status = p_status, updated_at = now() where id = p_tenant_id;
  insert into tenant_events (tenant_id, action, actor, detail)
  values (p_tenant_id, 'status_changed', v_actor, jsonb_build_object('from', v.status, 'to', p_status));
  return jsonb_build_object('id', v.id, 'status', p_status);
end $$;

-- ---- keys --------------------------------------------------------------------
-- Hashes only; api/ops-tenants.mjs generates the secrets and shows them once.
create or replace function ops_rotate_keys(
  p_tenant_id uuid, p_admin_key_hash text, p_pos_secret_hash text, p_actor text
) returns jsonb language plpgsql as $$
declare v_actor text := ops_require_actor(p_actor);
begin
  update tenants
     set admin_key_hash = coalesce(p_admin_key_hash, admin_key_hash),
         pos_secret_hash = coalesce(p_pos_secret_hash, pos_secret_hash),
         updated_at = now()
   where id = p_tenant_id;
  if not found then
    raise exception 'tenant_not_found' using errcode = '22023';
  end if;
  insert into tenant_events (tenant_id, action, actor, detail)
  values (p_tenant_id, 'keys_rotated', v_actor,
          jsonb_build_object('adminKey', p_admin_key_hash is not null,
                             'posSecret', p_pos_secret_hash is not null));
  return jsonb_build_object('id', p_tenant_id);
end $$;

-- ---- presets -----------------------------------------------------------------
create or replace function ops_review_preset(p_preset_id text, p_reviewer text)
returns jsonb language plpgsql as $$
declare v_reviewer text := ops_require_actor(p_reviewer); v_status text;
begin
  select status into v_status from reward_presets where id = p_preset_id for update;
  if v_status is null then
    raise exception 'preset_not_found' using errcode = '22023';
  end if;
  if v_status <> 'draft' then
    raise exception 'preset_not_draft' using errcode = '22023';
  end if;
  update reward_presets
     set status = 'reviewed', reviewed_by = v_reviewer, reviewed_at = now()
   where id = p_preset_id;
  return jsonb_build_object('id', p_preset_id, 'status', 'reviewed', 'reviewedBy', v_reviewer);
end $$;

create or replace function ops_list_presets()
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'description', p.description,
           'pointsThreshold', p.points_threshold, 'tiers', p.tiers, 'status', p.status,
           'reviewedBy', p.reviewed_by, 'reviewedAt', p.reviewed_at) order by p.id), '[]'::jsonb)
    from reward_presets p
$$;

-- ---- reads -------------------------------------------------------------------
create or replace function ops_overview()
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status,
           'gameFormat', t.game_format, 'published', t.brand_config is not null,
           'createdAt', t.created_at,
           'players',    (select count(*) from players p where p.tenant_id = t.id),
           'plays7d',    (select count(*) from runs r
                           where r.tenant_id = t.id and r.created_at > now() - interval '7 days'),
           'wins7d',     (select count(*) from wheel_wins w
                           where w.tenant_id = t.id and w.created_at > now() - interval '7 days'),
           'redeemed7d', (select count(*) from wheel_wins w
                           where w.tenant_id = t.id and w.redeemed
                             and w.redeemed_at > now() - interval '7 days'),
           'lastPlayAt', (select max(r.created_at) from runs r where r.tenant_id = t.id)
         ) order by t.created_at), '[]'::jsonb)
    from tenants t
$$;

create or replace function ops_tenant_detail(p_slug text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status,
      'gameFormat', t.game_format, 'couponPrefix', t.coupon_prefix,
      'published', t.brand_config is not null, 'manifest', t.brand_config,
      'publishedVersionId', t.published_version_id, 'rewardPresetId', t.reward_preset_id,
      'hasAdminKey', t.admin_key_hash is not null, 'hasPosSecret', t.pos_secret_hash is not null,
      'createdAt', t.created_at, 'updatedAt', t.updated_at),
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'state', v.state, 'rewardPresetId', v.reward_preset_id,
        'prizeLabels', v.prize_labels, 'manifest', v.manifest,
        'createdBy', v.created_by, 'createdAt', v.created_at,
        'publishedBy', v.published_by, 'publishedAt', v.published_at) order by v.id desc)
      from tenant_config_versions v where v.tenant_id = t.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'action', e.action, 'actor', e.actor, 'detail', e.detail, 'at', e.created_at) order by e.id desc)
      from (select * from tenant_events where tenant_id = t.id order by id desc limit 25) e), '[]'::jsonb)
  )
  from tenants t
  where t.slug = p_slug
$$;

-- ---- privileges --------------------------------------------------------------
do $$
declare
  fn text;
  v_ops constant text[] := array[
    'ops_require_actor(text)', 'compose_rewards(text,jsonb)',
    'ops_create_tenant(text,text,game_format,text,text)',
    'ops_save_draft(uuid,jsonb,text,jsonb,text)',
    'ops_version_manifest(bigint)', 'ops_publish_version(bigint,text)',
    'ops_set_tenant_status(uuid,tenant_status,text)',
    'ops_rotate_keys(uuid,text,text,text)',
    'ops_review_preset(text,text)', 'ops_list_presets()',
    'ops_overview()', 'ops_tenant_detail(text)'
  ];
begin
  foreach fn in array v_ops loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', fn);
    end if;
    execute format('grant execute on function %s to ops_admin', fn);
  end loop;
end $$;

commit;
