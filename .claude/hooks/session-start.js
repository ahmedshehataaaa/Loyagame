#!/usr/bin/env node
// SessionStart hook: orient a fresh session in under a second, without
// asking Claude to re-derive things a script can just print.
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const line = (s = '') => process.stdout.write(s + '\n');

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

line('## Slice Rush session start');
line(`Repo root: ${ROOT}`);

const isGit = sh('git rev-parse --is-inside-work-tree');
if (isGit === 'true') {
  line(`Branch: ${sh('git branch --show-current') || '(detached)'}`);
  const status = sh('git status --porcelain');
  line(
    status ? `Working tree: ${status.split('\n').length} changed file(s)` : 'Working tree: clean',
  );
} else {
  line(
    'Git: no repository here yet (expected — see docs/project-inventory.md "blockers"). git init requires human approval before it happens.',
  );
}

line('');
line(
  'Essential commands: `python3 server.py` (threaded dev server, http://localhost:8765; add ?play&dev&anyday to bypass gates). No package.json yet — no npm test/build/lint.',
);

line('');
line('Read first: CLAUDE.md (project boundaries + security non-negotiables).');
const openFlag = path.join(ROOT, 'docs', 'security', 'reward-wheel-compliance.md');
if (fs.existsSync(openFlag)) {
  line(
    '⚠️  OPEN COMPLIANCE FLAG: docs/security/reward-wheel-compliance.md — read before touching WHEEL or resolve_run.',
  );
}

const decisions = path.join(ROOT, 'docs', 'decisions');
if (fs.existsSync(decisions)) {
  const adrs = fs
    .readdirSync(decisions)
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (adrs.length) line(`Recent decisions: ${adrs.slice(-3).join(', ')} (docs/decisions/)`);
}

process.exit(0);
