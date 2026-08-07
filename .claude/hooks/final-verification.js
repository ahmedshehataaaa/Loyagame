#!/usr/bin/env node
// Stop hook: last check before Claude ends its turn. Runs the subset of
// the 12-point Definition-of-Done checklist that's mechanically checkable
// today (no test suite/lint/typecheck exist yet — see
// docs/project-inventory.md). Prints the rest as an explicit reminder
// rather than silently skipping them. Non-blocking by default: this is a
// checklist surfacer, not a hard gate, because several of its 12 points
// (e.g. "security review passed") require human/LLM judgment a script
// can't verify — see subagent-evidence-check.js for the same tradeoff.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');

const ROOT = process.cwd();
function sh(cmd) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const notes = [];
const isGit = sh('git rev-parse --is-inside-work-tree') === 'true';

if (isGit) {
  const diff = sh('git diff --stat HEAD');
  if (diff)
    notes.push(
      `Uncommitted changes present — confirm this diff matches the requested scope:\n${diff}`,
    );
} else {
  notes.push(
    'No git repo yet — "git diff matches requested scope" cannot be mechanically checked. Compare changed files by hand against what was asked.',
  );
}

// Cheap, repo-wide scan for the specific leftovers this project has a
// documented history of shipping (see project-inventory.md).
const scanTargets = ['engine', 'src', 'api', 'lib'];
const cheatHits = [];
for (const dir of scanTargets) {
  if (!fs.existsSync(dir)) continue;
  const grep = sh(
    `grep -rniE "ffn_dev|SUPABASE_SERVICE_KEY\\s*=\\s*['\\"]|ADMIN_KEY\\s*=\\s*['\\"]" ${dir} --include=*.js --include=*.mjs`,
  );
  if (grep) cheatHits.push(grep);
}
if (cheatHits.length) {
  notes.push(`Possible leftover cheat keys / hardcoded secrets found:\n${cheatHits.join('\n')}`);
}

if (fs.existsSync('docs/security/reward-wheel-compliance.md')) {
  const diff = isGit ? sh('git diff --name-only HEAD') : '';
  const touchedRewardCode =
    diff && /(engine\/config\.js|supabase\/schema\.sql|resolve_run)/i.test(diff);
  if (touchedRewardCode) {
    notes.push(
      'Reward/wheel-related files changed — confirm the security-adversary review ran (see REVIEW.md) before calling this done.',
    );
  }
}

notes.push(
  'Manual checklist (not mechanically checkable here — confirm by hand): ' +
    'formatting/lint/typecheck (no tooling configured yet), unit/integration tests (none exist yet), ' +
    'browser/gameplay verification for UI/gameplay changes, production build check, ' +
    'docs updated if architecture changed, no unresolved placeholders remain.',
);

if (notes.length) {
  process.stderr.write('final-verification reminders:\n- ' + notes.join('\n- ') + '\n');
}
process.exit(0);
