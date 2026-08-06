#!/usr/bin/env node
// PreToolUse hook (matcher: Bash). Blocks (exit 2) commands that match a
// known-dangerous pattern for THIS project, per CLAUDE.md's "Operations
// that require human approval". Blocking means the harness's own
// permission prompt / the human decides — this hook does not itself grant
// approval, it just stops the risky class of command from running silently
// inside an otherwise-approved Bash call.
'use strict';

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(input); } catch { process.exit(0); }

  const cmd = payload?.tool_input?.command;
  if (!cmd || typeof cmd !== 'string') process.exit(0);

  const rules = [
    [/git\s+push\s+.*(--force|-f\b)/i, 'force push'],
    [/git\s+reset\s+--hard/i, 'destructive git reset (--hard)'],
    [/git\s+clean\s+.*-[a-z]*f/i, 'destructive git clean'],
    [/git\s+branch\s+-D/i, 'force branch delete'],
    [/\brm\s+-rf\s+\S/i, 'recursive force delete (rm -rf)'],
    [/Remove-Item\s+.*-Recurse.*-Force/i, 'recursive force delete (Remove-Item)'],
    [/\b(cat|type|Get-Content)\s+.*\.env\b/i, 'reading a .env file — check this is actually necessary before printing secrets'],
    [/(SUPABASE_SERVICE_KEY|ADMIN_KEY|FOODICS_WEBHOOK_SECRET)\s*=\s*['"]/i, 'a secret value looks like it is being hardcoded/echoed inline, not read from process.env'],
    [/--no-verify/i, 'skipping git hooks (--no-verify)'],
    [/--no-gpg-sign|commit\.gpgsign=false/i, 'bypassing commit signing'],
    [/vercel\s+.*(deploy\s+)?--prod\b/i, 'Vercel production deploy'],
    [/netlify\s+deploy\s+.*--prod\b/i, 'Netlify production deploy'],
    [/vercel\s+link\b/i, 'changing the Vercel project link — see ADR 0002, verify the target project by hand'],
    [/supabase\s+db\s+reset/i, 'Supabase DB reset'],
    [/\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE)\b/i, 'destructive SQL (DROP/TRUNCATE)'],
    [/terraform\s+destroy/i, 'infrastructure destroy'],
    [/ALTER\s+TABLE\s+.*DISABLE\s+ROW\s+LEVEL\s+SECURITY/i, 'disabling Postgres RLS'],
    [/\brm\b.*(\.test\.|\.spec\.|[\\/]tests?[\\/])/i, 'deleting a test file — if this is to make a build pass rather than a genuine cleanup, stop and fix the underlying issue instead'],
  ];

  for (const [re, reason] of rules) {
    if (re.test(cmd)) {
      process.stderr.write(
        `BLOCKED by pre-dangerous-command hook: ${reason}.\n` +
        `Command: ${cmd}\n` +
        `This is listed in CLAUDE.md under "Operations that require human approval". ` +
        `Stop and ask the user explicitly before retrying — do not work around this hook.\n`
      );
      process.exit(2);
    }
  }
  process.exit(0);
});
