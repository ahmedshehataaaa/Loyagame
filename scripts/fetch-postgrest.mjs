#!/usr/bin/env node
/* Download the PostgREST binary the integration tests run against.
 *
 * The isolation guarantees in ADR 0018 live in the interaction between a JWT,
 * PostgREST's role switch and Postgres RLS. A mock of any of the three would
 * test the mock, so the tests run the real binary (pinned below) against a
 * real Postgres (embedded-postgres).
 *
 * Output: .cache/postgrest/postgrest[.exe]   (gitignored)
 *
 * WINDOWS: the binary needs libpq.dll, which is copied from embedded-postgres,
 * and the Microsoft Visual C++ 2015-2022 x64 runtime. If Postgres itself fails
 * to start with exit code 3221225781 (0xC0000135, "DLL not found"), install
 * that redistributable — both binaries need it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const POSTGREST_VERSION = 'v16.3';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.cache', 'postgrest');
const isWin = process.platform === 'win32';

export const postgrestPath = () => join(DIR, isWin ? 'postgrest.exe' : 'postgrest');

function assetName() {
  const v = POSTGREST_VERSION;
  if (isWin) return `postgrest-${v}-windows-x86-64.zip`;
  if (process.platform === 'darwin') {
    return `postgrest-${v}-macos-${process.arch === 'arm64' ? 'aarch64' : 'x86-64'}.tar.xz`;
  }
  return `postgrest-${v}-linux-static-${process.arch === 'arm64' ? 'aarch64' : 'x86-64'}.tar.xz`;
}

/** Windows only: PostgREST links libpq dynamically; embedded-postgres ships it. */
function copyWindowsDlls() {
  // The package's `exports` map hides package.json from require.resolve, so
  // locate it from its entry point instead.
  const require = createRequire(import.meta.url);
  let dir = dirname(require.resolve('@embedded-postgres/windows-x64'));
  while (!existsSync(join(dir, 'native', 'bin')) && dirname(dir) !== dir) dir = dirname(dir);
  const bin = join(dir, 'native', 'bin');
  if (!existsSync(bin)) throw new Error('embedded-postgres Windows binaries not found');
  for (const f of readdirSync(bin).filter((n) => n.toLowerCase().endsWith('.dll'))) {
    copyFileSync(join(bin, f), join(DIR, f));
  }
}

export async function ensurePostgrest() {
  const bin = postgrestPath();
  if (existsSync(bin)) {
    // An earlier run can extract the binary and fail before copying its DLLs;
    // without this check that half-finished cache would never repair itself.
    if (isWin && !existsSync(join(DIR, 'libpq.dll'))) copyWindowsDlls();
    return bin;
  }

  mkdirSync(DIR, { recursive: true });
  const name = assetName();
  const url = `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/${name}`;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PostgREST download failed: ${res.status} ${url}`);
  const archive = join(DIR, name);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

  // Windows: name System32's bsdtar explicitly. A Git-for-Windows shell puts
  // GNU tar first on PATH, and GNU tar reads "C:\..." as a remote host.
  const tar = isWin ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, isWin ? ['-xf', archive, '-C', DIR] : ['-xJf', archive, '-C', DIR], {
    stdio: 'inherit',
  });
  rmSync(archive);
  if (isWin) copyWindowsDlls();
  if (!existsSync(bin)) throw new Error(`PostgREST binary not found after extracting ${name}`);
  return bin;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  ensurePostgrest()
    .then((p) => console.log(`PostgREST at ${p}`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
