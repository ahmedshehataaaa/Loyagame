#!/usr/bin/env node
// PostToolUse hook (matcher: Edit|Write). Runs the checks that are
// actually possible in this repo today (no package.json yet, so no
// lint/typecheck tooling exists) — syntax-checks JS, validates JSON,
// scans for hardcoded secrets and leftover cheat/debug hooks. Designed to
// also pick up npm scripts automatically once a package.json exists,
// rather than staying hardcoded to "there is no tooling" forever.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(input); } catch { process.exit(0); }

  const filePath = payload?.tool_input?.file_path;
  if (!filePath || !fs.existsSync(filePath)) process.exit(0);

  const warnings = [];
  const blockers = [];
  const ext = path.extname(filePath).toLowerCase();
  let content = '';
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { process.exit(0); }

  // --- syntax checks -------------------------------------------------
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    try { execSync(`node --check "${filePath}"`, { stdio: 'pipe' }); }
    catch (e) { blockers.push(`node --check failed:\n${e.stderr?.toString().trim() || e.message}`); }
  }
  if (ext === '.json') {
    try { JSON.parse(content); }
    catch (e) { blockers.push(`invalid JSON: ${e.message}`); }
  }

  // --- secret scanning -------------------------------------------------
  const secretPatterns = [
    [/SUPABASE_SERVICE_KEY\s*[:=]\s*['"][A-Za-z0-9._-]{10,}/, 'hardcoded SUPABASE_SERVICE_KEY (should be process.env only)'],
    [/ADMIN_KEY\s*[:=]\s*['"][^'"]{4,}/, 'hardcoded ADMIN_KEY'],
    [/FOODICS_WEBHOOK_SECRET\s*[:=]\s*['"][^'"]{4,}/, 'hardcoded FOODICS_WEBHOOK_SECRET'],
    [/AKIA[0-9A-Z]{16}/, 'looks like an AWS access key'],
    [/-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/, 'embedded private key'],
    [/sk_live_[A-Za-z0-9]{10,}/, 'looks like a live Stripe secret key'],
  ];
  for (const [re, reason] of secretPatterns) {
    if (re.test(content)) blockers.push(`possible secret committed: ${reason}`);
  }

  // --- known-bad leftovers (this project's specific history) -----------
  if (/\bffn_dev\b|localStorage\.\w+\s*=\s*['"]1['"].*dev/i.test(content) && /engine\//.test(filePath)) {
    warnings.push('looks like a client-side dev/cheat flag pattern (see fastfood-ninja lineage precedent) — confirm this is not shipping to production');
  }
  if (/TODO|FIXME|XXX/.test(content) && !/\.md$/.test(ext)) {
    const count = (content.match(/TODO|FIXME|XXX/g) || []).length;
    warnings.push(`${count} TODO/FIXME/XXX marker(s) left in this file`);
  }

  // --- config validation for known files --------------------------------
  const base = path.basename(filePath);
  if (base === 'vercel.json' || base === 'manifest.webmanifest') {
    try { JSON.parse(content); } catch (e) { blockers.push(`${base} is not valid JSON: ${e.message}`); }
  }

  // --- run npm scripts if a package.json now exists ---------------------
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      for (const script of ['lint', 'typecheck', 'format:check']) {
        if (pkg.scripts?.[script]) {
          try { execSync(`npm run ${script} --silent`, { stdio: 'pipe' }); }
          catch (e) { warnings.push(`npm run ${script} failed:\n${e.stdout?.toString().trim() || e.message}`); }
        }
      }
    } catch { /* malformed package.json will already be caught above if it's the edited file */ }
  }

  if (blockers.length) {
    process.stderr.write(`BLOCKED by post-edit-check on ${filePath}:\n- ${blockers.join('\n- ')}\n`);
    process.exit(2);
  }
  if (warnings.length) {
    process.stderr.write(`post-edit-check warnings on ${filePath}:\n- ${warnings.join('\n- ')}\n`);
  }
  process.exit(0);
});
