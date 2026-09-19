-- ============================================================
-- 0008 — Mint coupon codes without pgcrypto.
--
-- mint_coupon_code called gen_random_bytes, which is pgcrypto. Supabase
-- installs pgcrypto in the "extensions" schema, which is not on the
-- app_tenant role's search path and is not granted to it. So in production
-- every won round failed inside resolve_run with "function
-- gen_random_bytes(integer) does not exist". The transaction rolled back, so
-- the player saw "No prize has been issued". The tests created pgcrypto in
-- public, which hid this. They now mirror Supabase's layout.
--
-- gen_random_uuid() is core Postgres (13+), on every search path, and draws
-- from the same strong random source. A v4 UUID has fixed version/variant bits
-- in bytes 6 and 8, so the eight bytes used here (0-3 and 10-13) are all fully
-- random. Code format and alphabet are unchanged.
-- ============================================================
begin;

create or replace function mint_coupon_code(p_prefix text default 'MC')
returns text language plpgsql as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_uuid bytea;
  v_pos constant integer[] := array[0, 1, 2, 3, 10, 11, 12, 13];
  v_try integer := 0;
begin
  loop
    v_code := p_prefix || '-';
    v_uuid := uuid_send(gen_random_uuid());
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_uuid, v_pos[i]) & 31), 1);
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

commit;
