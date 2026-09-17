#!/usr/bin/env node
/* Apply database/migrations/*.sql in order, each exactly once.
 *
 * Until now `supabase/schema.sql` was pasted into the Supabase SQL editor by
 * hand, with no record of what had been applied where. Multi-tenancy (ADR 0018)
 * is the first change that is not safely re-runnable in full — it rewrites keys
 * and backfills data — so applied files are now recorded in
 * `claimlabs_migrations`, with a checksum so an already-applied file that was
 * later edited is refused instead of silently skipped.
 *
 * PRODUCTION IS A HUMAN DECISION (CLAUDE.md, .claude/rules/database-migrations.md).
 * This script refuses any host that is not local unless `--confirm-remote` is
 * passed, and it prints exactly what it is about to touch first.
 *
 *   DATABASE_URL=postgres://... node scripts/db-migrate.mjs [--baseline] [--confirm-remote] [--dry-run]
 *
 * --baseline  apply supabase/schema.sql first. Only for a FRESH database; a
 *             live instance already has it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'database', 'migrations');
const BASELINE = join(ROOT, 'supabase', 'schema.sql');

const sha = (text) => createHash('sha256').update(text).digest('hex');

export function listMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
      return { name, sql, checksum: sha(sql) };
    });
}

/**
 * Apply pending migrations through an already-connected `pg` client.
 * Exported so the integration tests migrate exactly the way a human does.
 *
 * @param {import('pg').Client} client
 * @param {{baseline?: boolean, dryRun?: boolean, log?: (msg: string) => void}} [opts]
 * @returns {Promise<string[]>} names applied
 */
export async function applyMigrations(client, { baseline = false, dryRun = false, log = console.log } = {}) {
  if (baseline && !dryRun) {
    log('applying baseline supabase/schema.sql');
    await client.query(readFileSync(BASELINE, 'utf8'));
  }

  await client.query(`
    create table if not exists claimlabs_migrations (
      name       text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`);
  const { rows } = await client.query('select name, checksum from claimlabs_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));

  const done = [];
  for (const m of listMigrations()) {
    if (applied.has(m.name)) {
      if (applied.get(m.name) !== m.checksum) {
        throw new Error(
          `${m.name} was applied with a different checksum. An applied migration must never be edited — write a new one.`,
        );
      }
      continue;
    }
    if (dryRun) {
      log(`would apply ${m.name}`);
      done.push(m.name);
      continue;
    }
    log(`applying ${m.name}`);
    // Each file carries its own begin/commit, so it is also safe to paste into
    // the SQL editor. It is recorded only after it committed.
    await client.query(m.sql);
    await client.query('insert into claimlabs_migrations (name, checksum) values ($1, $2)', [
      m.name,
      m.checksum,
    ]);
    done.push(m.name);
  }
  return done;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const { hostname, pathname } = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  console.log(`target: ${hostname}${pathname}${local ? ' (local)' : ' (REMOTE)'}`);
  if (!local && !args.has('--confirm-remote')) {
    console.error('Refusing a non-local database without --confirm-remote. Back it up first.');
    process.exit(2);
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  client.on('notice', (n) => console.log(`  notice: ${n.message}`));
  try {
    const done = await applyMigrations(client, {
      baseline: args.has('--baseline'),
      dryRun: args.has('--dry-run'),
    });
    console.log(done.length ? `done: ${done.join(', ')}` : 'nothing to apply');
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
