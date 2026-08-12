#!/usr/bin/env node
/* Production build -> dist/
 *
 * WHY A BUILD STEP NOW (and why the source tree still needs none):
 *
 * ADRs 0005/0006 deliberately kept this project bundler-free, and that is still
 * how you develop it — `npm run dev` serves the source directly, no compile,
 * no watch. That constraint is worth keeping for iteration speed.
 *
 * But two production problems cannot be solved without a build:
 *   1. NO CONTENT HASHING. Nothing in the shipped output has a hashed name, so
 *      a deploy cannot be cache-busted. The service worker had to be
 *      network-first purely to work around it (ADR 0013).
 *   2. 50 REQUESTS on cold load, ~30 of them individual ES modules. Each is a
 *      round trip before the next import is even discovered.
 *
 * So: source stays unbundled, and `npm run build` produces a hashed, minified
 * dist/ for deployment. The dev path and the prod path are both first-class,
 * and tests/e2e/production-build.spec.js proves dist/ actually boots and plays.
 */
import { build } from 'esbuild';
import {
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  cpSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const OUT = 'dist';
const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/* ---- 1. The engine: classic scripts, concatenated in load order ---------
   These are IIFEs that publish onto `window` and depend on each other's
   globals, so they must NOT be treated as modules. Bundling them as one
   classic script preserves the exact semantics while collapsing 4 requests
   into 1. */
const ENGINE = ['config.js', 'platform.js', 'audio.js', 'game.js'];
/* Minified one file at a time, then concatenated in load order.
   esbuild refuses multiple entry points without an outdir — but more
   importantly these must NOT be bundled as a module graph: they are classic
   scripts sharing top-level scope, and `game.js` reads `SPECIALS` straight out
   of `config.js`'s scope. Concatenation is the only transform that preserves
   that exactly. */
const engineParts = [];
for (const file of ENGINE) {
  const out = await build({
    entryPoints: [join('engine', file)],
    bundle: false,
    minify: true,
    format: 'iife',
    target: ['es2022'],
    write: false,
  });
  engineParts.push(out.outputFiles[0].text);
}
const engineSrc = engineParts.join('\n;\n');
const engineName = `engine.${hash8(engineSrc)}.js`;
writeFileSync(join(OUT, engineName), engineSrc);

/* ---- 2. The app shell: a real ES module graph -------------------------- */
const appResult = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022'],
  /* 'external' not true: with write:false and no outfile, esbuild INLINES the
     map as a base64 data URI, which took the shipped bundle from 76 KB to
     409 KB. External keeps the map a separate file that only a developer
     opening devtools ever downloads. */
  sourcemap: 'external',
  // esbuild requires an output path for an external map even with write:false;
  // the name is only used to key the returned outputFiles, never written here.
  outfile: 'app.js',
  write: false,
  legalComments: 'none',
});
/* Select by "is not the map" rather than by extension: with sourcemaps on,
   esbuild emits both and the order is not guaranteed. */
const appMap = appResult.outputFiles.find((f) => f.path.endsWith('.map'));
const appJs = appResult.outputFiles.find((f) => !f.path.endsWith('.map'));
const appName = `app.${hash8(appJs.text)}.js`;
/* Link the map by its hashed name. Written after hashing so the comment does
   not feed back into the hash. */
writeFileSync(
  join(OUT, appName),
  appMap
    ? `${appJs.text}
//# sourceMappingURL=${appName}.map
`
    : appJs.text,
);
if (appMap) writeFileSync(join(OUT, `${appName}.map`), appMap.text);

/* ---- 3. CSS: one hashed file in cascade order -------------------------- */
const CSS = ['tokens.css', 'base.css', 'components.css', 'screens.css', 'reference.css'];
const cssResult = await build({
  stdin: {
    contents: CSS.map((f) => `@import "./src/styles/${f}";`).join('\n'),
    resolveDir: '.',
    loader: 'css',
  },
  bundle: true,
  minify: true,
  write: false,
});
const cssText = cssResult.outputFiles[0].text;
const cssName = `app.${hash8(cssText)}.css`;
writeFileSync(join(OUT, cssName), cssText);

/* ---- 4. Static passthrough --------------------------------------------
   `supabase/` is deliberately NOT copied. dist/ is what vercel.json publishes
   as `outputDirectory`, so everything in here is served as a PUBLIC static
   file — and dist/supabase/schema.sql would have handed anyone the full
   database structure: every RPC body, the anti-cheat thresholds resolve_run()
   checks against, and mint_coupon_code()'s alphabet. The file has no runtime
   role in a deploy (it is applied by hand against Supabase, per
   .claude/rules/database-migrations.md), so nothing needs it here.

   `api/` and `lib/` are still copied because they are the serverless
   functions and their shared helper. They contain no secrets — every one
   reads process.env — but their source is readable at /api/*.mjs on a
   deployed site. Confirm against a real preview deployment whether Vercel
   resolves functions from the repo root (making these copies redundant and
   removable) before changing this list further. */
for (const dir of ['assets', 'campaigns', 'api', 'netlify', 'lib']) {
  if (existsSync(dir)) cpSync(dir, join(OUT, dir), { recursive: true });
}
/* admin.html is NOT copied here any more — it is generated by
   scripts/build-dashboard.mjs, which runs after this script (see ADR 0017). */
for (const file of ['icon.svg', 'manifest.webmanifest', 'vercel.json', 'netlify.toml']) {
  if (existsSync(file)) cpSync(file, join(OUT, file));
}

/* ---- 5. index.html, rewritten to the hashed names ---------------------- */
let html = readFileSync('index.html', 'utf8');
html = html
  .replace(/\s*<link rel="stylesheet" href="src\/styles\/[^"]+"\s*\/?>/g, '')
  .replace('</head>', `    <link rel="stylesheet" href="${cssName}" />\n  </head>`)
  .replace(/\s*<script src="engine\/[^"]+"><\/script>/g, '')
  .replace(
    '<script type="module" src="src/main.js"></script>',
    `<script src="${engineName}"></script>\n    <script type="module" src="${appName}"></script>`,
  );
writeFileSync(join(OUT, 'index.html'), html);

/* ---- 6. Service worker, with its shell list rewritten ------------------
   The SW's shell must name the hashed files or it caches paths that 404 —
   precisely how the previous service worker silently never installed. */
let sw = readFileSync('sw.js', 'utf8');
sw = sw
  .replace(/const VERSION = '[^']*';/, `const VERSION = 'mcslice-${hash8(appJs.text)}';`)
  .replace(
    /const SHELL = \[[\s\S]*?\];/,
    `const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './${engineName}',
  './${appName}',
  './${cssName}',
];`,
  );
writeFileSync(join(OUT, 'sw.js'), sw);

/* ---- Report ----------------------------------------------------------- */
const size = (p) => statSync(p).size;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );
const all = walk(OUT);
const total = all.reduce((n, f) => n + size(f), 0);

console.log(`\nBuilt ${OUT}/`);
console.log(`  ${cssName.padEnd(28)} ${kb(size(join(OUT, cssName)))}`);
console.log(`  ${engineName.padEnd(28)} ${kb(size(join(OUT, engineName)))}`);
console.log(`  ${appName.padEnd(28)} ${kb(size(join(OUT, appName)))}`);
console.log(
  `  ${'assets/'.padEnd(28)} ${kb(walk(join(OUT, 'assets')).reduce((n, f) => n + size(f), 0))}`,
);
console.log(`  ${'total'.padEnd(28)} ${kb(total)}  (${all.length} files)`);
