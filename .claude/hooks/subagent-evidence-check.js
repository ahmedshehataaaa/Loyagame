#!/usr/bin/env node
// SubagentStop hook. A shell script cannot force an LLM's final message to
// contain real evidence — it can only check structural signals and nag
// when they're missing. Use this as a tripwire, not a guarantee; the
// lead-architect agent is still responsible for actually judging the
// substance of what comes back, per CLAUDE.md's Definition of Done.
'use strict';
const fs = require('fs');

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const transcriptPath = payload?.transcript_path || payload?.agent_transcript_path;
  let text = '';
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      text = fs.readFileSync(transcriptPath, 'utf8').slice(-8000);
    } catch {
      /* ignore */
    }
  }
  if (!text) process.exit(0); // nothing to inspect; don't block on absence of data

  const required = [
    [/files? (inspected|changed|touched|modified)/i, 'files inspected/changed'],
    [/acceptance criteria/i, 'acceptance-criteria status'],
    [/(command|test|curl|screenshot|verified|ran)/i, 'evidence a command/test was actually run'],
    [/(risk|limitation|known issue|caveat|open|blocker)/i, 'risks/limitations'],
  ];

  const missing = required.filter(([re]) => !re.test(text)).map(([, label]) => label);

  if (missing.length >= 3) {
    process.stderr.write(
      `subagent-evidence-check: this subagent's final report is missing ${missing.join(', ')}. ` +
        `Per CLAUDE.md's Definition of Done, "I read the code and it looks right" is not sufficient. ` +
        `Ask the subagent (or re-verify yourself) for concrete evidence before treating this as done.\n`,
    );
    // Non-blocking (exit 0, not 2): a false positive here shouldn't wedge
    // the session. This is a nag, not a hard gate — the lead-architect
    // (or the user) makes the real call.
  }
  process.exit(0);
});
