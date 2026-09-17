-- ============================================================
-- 0006 — Tenant brand assets in Supabase Storage (ADR 0018).
--
-- One public bucket, one folder per tenant: tenant-assets/<tenant id>/...
--
-- Sprites and logos are loaded by players' browsers, so they are public
-- by nature and served from the bucket's public URL. What IS scoped to
-- the tenant is writing and listing: an ops_admin token for tenant A
-- can only write under A's folder, and no role is given a SELECT
-- policy, so the bucket cannot be enumerated through the API.
--
-- The API uploads through signed upload URLs whose path it builds
-- itself (api/ops-assets.mjs), so these policies are the second line,
-- not the first.
--
-- Plain Postgres has no storage schema; the file is a no-op there.
-- ============================================================
begin;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice '0006: no storage schema on this database; skipping';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('tenant-assets', 'tenant-assets', true)
  on conflict (id) do nothing;

  -- Sprites only, and small: a phone downloads every one of them on first load.
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets'
                and column_name = 'allowed_mime_types') then
    update storage.buckets
       set allowed_mime_types = array['image/png', 'image/webp', 'image/jpeg'],
           file_size_limit = 2097152
     where id = 'tenant-assets';
  end if;

  grant usage on schema storage to ops_admin;
  grant insert, update, delete on storage.objects to ops_admin;

  execute 'drop policy if exists tenant_assets_ops_insert on storage.objects';
  execute $p$
    create policy tenant_assets_ops_insert on storage.objects for insert to ops_admin
    with check (bucket_id = 'tenant-assets'
                and (storage.foldername(name))[1] = current_tenant()::text)
  $p$;

  execute 'drop policy if exists tenant_assets_ops_update on storage.objects';
  execute $p$
    create policy tenant_assets_ops_update on storage.objects for update to ops_admin
    using (bucket_id = 'tenant-assets' and (storage.foldername(name))[1] = current_tenant()::text)
    with check (bucket_id = 'tenant-assets' and (storage.foldername(name))[1] = current_tenant()::text)
  $p$;

  execute 'drop policy if exists tenant_assets_ops_delete on storage.objects';
  execute $p$
    create policy tenant_assets_ops_delete on storage.objects for delete to ops_admin
    using (bucket_id = 'tenant-assets' and (storage.foldername(name))[1] = current_tenant()::text)
  $p$;
end $$;

commit;
