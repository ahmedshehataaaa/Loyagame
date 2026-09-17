import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

/* api/ (Vercel) and netlify/functions/ (Netlify) are hand-maintained copies
   (.claude/rules/backend-api.md). A change to one without the other is drift,
   and until now nothing but reviewer attention caught it. The only permitted
   difference is where each copy imports its helpers from. */

const toApiPaths = (src) =>
  src.replaceAll("'./_lib/db.mjs'", "'../lib/db.mjs'").replaceAll("'../../src/", "'../src/");

describe('Netlify mirrors of the API', () => {
  const files = readdirSync('api').filter((f) => f.endsWith('.mjs'));

  it('exist for every function', () => {
    const missing = files.filter((f) => !existsSync(`netlify/functions/${f}`));
    expect(missing).toEqual([]);
  });

  for (const file of files) {
    it(`${file} is identical apart from import paths`, () => {
      const api = readFileSync(`api/${file}`, 'utf8');
      const netlify = readFileSync(`netlify/functions/${file}`, 'utf8');
      expect(toApiPaths(netlify)).toBe(api);
    });
  }

  it('share one copy of the database helpers', () => {
    expect(readFileSync('netlify/functions/_lib/db.mjs', 'utf8')).toBe(readFileSync('lib/db.mjs', 'utf8'));
  });
});
