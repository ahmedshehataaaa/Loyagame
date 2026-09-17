/* A real database stack for integration tests.
 *
 * embedded-postgres (a real Postgres binary) + the Supabase roles and default
 * grants + the baseline schema + every migration, and optionally the real
 * PostgREST binary in front of it. Nothing here is mocked: the guarantees under
 * test — row locks, unique constraints, RLS, the JWT role switch — are exactly
 * the kind a mock would quietly fake (.claude/rules/tests.md).
 */
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from '../../../scripts/db-migrate.mjs';
import { ensurePostgrest } from '../../../scripts/fetch-postgrest.mjs';

export const LEGACY_TENANT = '00000000-0000-4000-8000-000000000001';
export const JWT_SECRET = 'integration-tests-only-secret-0123456789abcdef';
const AUTHENTICATOR_PASSWORD = 'authenticator-test-password';

/* What a Supabase project has before any of our SQL runs: the client roles,
   PostgREST's login role, and DEFAULT PRIVILEGES that grant those client roles
   everything we create. Reproducing the permissive defaults matters — the
   migrations have to be safe on top of them, not on top of a locked-down
   database that production is not. The storage schema is a minimal stand-in
   with the two objects 0006 touches. */
const SUPABASE_SHIM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password '${AUTHENTICATOR_PASSWORD}';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  created_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $f$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$f$;
alter table storage.objects enable row level security;
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(check, { timeoutMs = 30000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}

/**
 * @param {{
 *   postgrest?: boolean,
 *   beforeMigrations?: (client: pg.Client) => Promise<void>,
 * }} [opts]
 */
export async function startStack({ postgrest = false, beforeMigrations } = {}) {
  const pgPort = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'claimlabs-pg-'));
  const db = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await db.initialise();
  await db.start();

  const admin = new pg.Client({
    host: '127.0.0.1',
    port: pgPort,
    user: 'postgres',
    password: 'postgres',
    database: 'postgres',
  });
  await admin.connect();
  admin.on('notice', () => {});

  await admin.query(SUPABASE_SHIM);
  await admin.query(readFileSync('supabase/schema.sql', 'utf8'));
  if (beforeMigrations) await beforeMigrations(admin);
  const applied = await applyMigrations(admin, { log: () => {} });

  let rest = null;
  let restUrl = null;
  if (postgrest) {
    const bin = await ensurePostgrest();
    const port = await freePort();
    const adminPort = await freePort();
    rest = spawn(bin, [], {
      env: {
        ...process.env,
        PGRST_DB_URI: `postgres://authenticator:${AUTHENTICATOR_PASSWORD}@127.0.0.1:${pgPort}/postgres`,
        PGRST_DB_SCHEMAS: 'public',
        PGRST_DB_ANON_ROLE: 'anon',
        PGRST_JWT_SECRET: JWT_SECRET,
        PGRST_SERVER_HOST: '127.0.0.1',
        PGRST_SERVER_PORT: String(port),
        PGRST_ADMIN_SERVER_PORT: String(adminPort),
        PGRST_DB_CHANNEL_ENABLED: 'false',
        PGRST_LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // PostgREST logs its startup errors to STDOUT, so both streams are kept.
    let output = '';
    rest.stdout.on('data', (d) => (output += d));
    rest.stderr.on('data', (d) => (output += d));
    await waitFor(
      async () => {
        if (rest.exitCode !== null) {
          throw new Error(`PostgREST exited with code ${rest.exitCode}: ${output.slice(-2000)}`);
        }
        const r = await fetch(`http://127.0.0.1:${adminPort}/ready`);
        return r.ok;
      },
      { label: 'PostgREST /ready' },
    );
    restUrl = `http://127.0.0.1:${port}`;
  }

  return {
    admin,
    pgPort,
    restUrl,
    applied,
    /** A fresh connection as the superuser, for parallel work. */
    async connect() {
      const c = new pg.Client({
        host: '127.0.0.1',
        port: pgPort,
        user: 'postgres',
        password: 'postgres',
        database: 'postgres',
      });
      await c.connect();
      c.on('notice', () => {});
      return c;
    },
    async stop() {
      if (rest && rest.exitCode === null) rest.kill();
      await admin.end().catch(() => {});
      await db.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const ROLES = new Set(['app_tenant', 'ops_admin', 'tenant_resolver', 'anon', 'service_role']);

/**
 * Run `fn` inside a transaction as `role`, with `claims` as the verified JWT
 * claims — exactly the session state PostgREST establishes per request.
 *
 * @template T
 * @param {pg.Client} client
 * @param {string} role
 * @param {Record<string, unknown>|null} claims
 * @param {(c: pg.Client) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function asRole(client, role, claims, fn) {
  if (!ROLES.has(role)) throw new Error(`unknown role ${role}`);
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    if (claims) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
    }
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

export const asTenant = (client, tenantId, fn) =>
  asRole(client, 'app_tenant', { role: 'app_tenant', tenant_id: tenantId }, fn);

export const asOps = (client, fn) => asRole(client, 'ops_admin', { role: 'ops_admin' }, fn);

/** A manifest that passes src/campaign/schema.js, for a given slug. */
export function manifestFor(slug, { name = 'Test Brand', roundSeconds = 30 } = {}) {
  return {
    schemaVersion: 1,
    brand: { id: slug, name, gameName: `${name} Rush`, locales: ['en', 'ar'] },
    rules: { roundSeconds, lives: 2 },
    items: [{ id: 'burger', label: 'Burger', img: 'assets/items/bigmac.png', points: 300, radius: 50 }],
    hazard: { id: 'burnt', img: 'assets/items/burnt.png', radius: 48 },
    campaign: { startsAt: null, endsAt: null },
  };
}

/**
 * Labels for every relabelable tier of the seeded standard-10 preset.
 * @type {Readonly<Record<string, string>>}
 */
export const STANDARD_LABELS = Object.freeze({
  side1: 'Free Fries',
  side2: 'Free Hash Brown',
  medium: 'Free Nuggets',
  dessert: 'Free Sundae',
  signature: 'Free Signature Burger',
});

/**
 * Create, draft and publish a tenant the way the ops dashboard does.
 * Reviews standard-10 first if nobody has.
 */
export async function onboardTenant(client, { slug, name, prefix, roundSeconds = 30 }) {
  return asOps(client, async (c) => {
    const { rows: presets } = await c.query(
      "select status from reward_presets where id = 'standard-10'",
    );
    if (presets[0].status === 'draft') {
      await c.query("select ops_review_preset('standard-10', 'Laila Hassan')");
    }
    const created = (
      await c.query("select ops_create_tenant($1, $2, 'slice_rush', $3, 'Omar Farouk') as t", [
        name,
        slug,
        prefix,
      ])
    ).rows[0].t;
    const draft = (
      await c.query("select ops_save_draft($1, $2, 'standard-10', $3, 'Omar Farouk') as d", [
        created.id,
        manifestFor(slug, { name, roundSeconds }),
        STANDARD_LABELS,
      ])
    ).rows[0].d;
    await c.query("select ops_publish_version($1, 'Omar Farouk')", [draft.versionId]);
    return { id: created.id, slug, versionId: draft.versionId };
  });
}

/**
 * Start a round for `phone` and resolve it as a survived round.
 * The run's start is backdated 40s as the superuser, because resolve_run
 * rightly flags a "30-second round" that finished in no wall-clock time.
 */
export async function playWinningRound(admin, tenantId, { phone, device, score = 1500 }) {
  const token = await asTenant(admin, tenantId, async (c) => {
    const { rows } = await c.query(
      "select * from start_play($1, '+20', $2, 24, 999999, 12, '2026-09')",
      [phone, device],
    );
    return rows[0].token;
  });
  if (!token) throw new Error('start_play granted no token');
  await admin.query("update runs set created_at = now() - interval '40 seconds' where token = $1", [
    token,
  ]);
  return asTenant(admin, tenantId, async (c) => {
    const { rows: s } = await c.query(
      "select key, value from settings where key in ('wheel_prizes', 'wheel_points_threshold')",
    );
    const settings = Object.fromEntries(s.map((r) => [r.key, r.value]));
    const { rows } = await c.query(
      'select * from resolve_run($1, $2, 31000, $3, $4, 5000, 2000000, $5, true)',
      [token, score, device, settings.wheel_points_threshold ?? 4000, JSON.stringify(settings.wheel_prizes ?? [])],
    );
    return { token, ...rows[0] };
  });
}
