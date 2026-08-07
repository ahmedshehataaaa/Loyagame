#!/usr/bin/env node
/* Validate every campaign manifest in campaigns/.
 *
 * Runs the SAME validator the app uses, so a manifest that would be rejected at
 * runtime fails the build instead — the whole point of a schema is that a bad
 * reskin is caught before a restaurant sees it, not after.
 *
 * Exit 1 on any error. Warnings are printed but do not fail: they are the
 * cosmetic-fallback class, and blocking a release over a hex code would be the
 * wrong trade (see src/campaign/schema.js). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCampaign, formatIssues } from '../src/campaign/schema.js';

const DIR = 'campaigns';
let failed = 0;
let warned = 0;

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`No manifests found in ${DIR}/`);
  process.exit(1);
}

for (const file of files) {
  const path = join(DIR, file);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`✗ ${path}\n  ERROR  not valid JSON: ${err.message}`);
    failed++;
    continue;
  }

  const result = validateCampaign(manifest);
  const report = formatIssues(result);

  if (!result.ok) {
    console.error(`✗ ${path}\n${report.replace(/^/gm, '  ')}`);
    failed++;
  } else if (result.warnings.length) {
    console.warn(`⚠ ${path}\n${report.replace(/^/gm, '  ')}`);
    warned++;
  } else {
    console.log(`✓ ${path}`);
  }
}

console.log(
  `\n${files.length} manifest(s): ${files.length - failed} valid, ${failed} invalid, ${warned} with warnings`,
);
process.exit(failed > 0 ? 1 : 0);
