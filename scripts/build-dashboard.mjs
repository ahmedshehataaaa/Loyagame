#!/usr/bin/env node
/* Admin dashboard build -> dist/admin.html + hashed assets
 *
 * WHY THIS IS A SEPARATE BUILD FROM scripts/build.mjs
 *
 * The game and the dashboard are two apps with nothing in common. The game is
 * the bundler-free vanilla build ADR 0013 describes; the dashboard is React +
 * shadcn/ui (ADR 0017). Keeping them in one esbuild invocation would drag
 * React into the game's dependency graph and put its bundle-size guard on the
 * wrong side of a 200KB library. They share only the output directory.
 *
 * `npm run build` runs both, so a deploy is still one command.
 *
 * NOTE ON dist/: build.mjs starts by wiping dist/. This script therefore runs
 * AFTER it, never before, or the dashboard is deleted the moment the game
 * builds. `npm run build` sequences them; running this one alone assumes
 * dist/ already exists and only refreshes the dashboard's own files.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const OUT = 'dist';
const SRC = 'dashboard';
const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

mkdirSync(OUT, { recursive: true });

/* Stale hashed bundles from a previous run would otherwise pile up in dist/
   when this script is run on its own (build.mjs wipes the directory, this one
   cannot — the game's output is already in there). */
for (const f of readdirSync(OUT)) {
  if (/^admin\.[0-9a-f]{8}\.(js|css)$/.test(f)) rmSync(join(OUT, f));
}

/* ---- 1. JS: one bundled, minified, hashed module ----------------------- */
const js = await build({
  entryPoints: [join(SRC, 'src', 'main.jsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx',
    /* main.jsx imports index.css so the dependency is visible in the source.
       Tailwind's CLI compiles that file separately below, so esbuild only
       needs to DROP the import — `empty` removes it outright. Marking it
       external instead would leave a live `import "./index.css"` in the ESM
       output, which the browser would then fail to fetch. */
    '.css': 'empty',
  },
  // React libraries branch on this; without it the dev build ships, which is
  // both slower and noisier in the console.
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
});
const jsText = js.outputFiles[0].text;
const jsName = `admin.${hash8(jsText)}.js`;
writeFileSync(join(OUT, jsName), jsText);

/* ---- 2. CSS: Tailwind v4 CLI, then hashed ------------------------------
   Tailwind scans the dashboard sources for the utilities actually used, so
   the emitted sheet is only what this app references. */
const cssTmp = join(OUT, '.admin.tailwind.tmp.css');
execFileSync(
  process.execPath,
  [
    join('node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs'),
    '--input',
    join(SRC, 'src', 'index.css'),
    '--output',
    cssTmp,
    '--minify',
  ],
  { stdio: 'inherit' },
);
const cssText = readFileSync(cssTmp, 'utf8');
rmSync(cssTmp);
const cssName = `admin.${hash8(cssText)}.css`;
writeFileSync(join(OUT, cssName), cssText);

/* ---- 3. index.html, rewritten to the hashed names ---------------------- */
let html = readFileSync(join(SRC, 'index.html'), 'utf8');
html = html.replace('"admin.css"', `"${cssName}"`).replace('"admin.js"', `"${jsName}"`);
if (html.includes('"admin.css"') || html.includes('"admin.js"')) {
  throw new Error('build-dashboard: asset placeholders were not rewritten');
}
writeFileSync(join(OUT, 'admin.html'), html);

/* ---- Report ----------------------------------------------------------- */
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const size = (p) => statSync(join(OUT, p)).size;
console.log('\nAdmin dashboard -> dist/');
console.log(`  admin.html        ${kb(size('admin.html'))}`);
console.log(`  ${jsName}   ${kb(size(jsName))}`);
console.log(`  ${cssName}  ${kb(size(cssName))}`);

/* The game build guards its own bundle size; this is the dashboard's guard.
   React + Recharts is inherently heavy, but a runaway import (pulling in all
   of lucide-react rather than the handful of icons used, say) should fail the
   build rather than quietly double an internal tool's payload. */
const BUDGET_KB = 900;
const totalKb = (size(jsName) + size(cssName)) / 1024;
if (totalKb > BUDGET_KB) {
  console.error(
    `\n✗ dashboard bundle ${totalKb.toFixed(1)} KB exceeds the ${BUDGET_KB} KB budget.`,
  );
  process.exit(1);
}
console.log(`  budget            ${totalKb.toFixed(1)} / ${BUDGET_KB} KB\n`);

if (!existsSync(join(OUT, 'admin.html'))) process.exit(1);
