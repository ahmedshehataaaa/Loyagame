import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/* engine/config.js declares FOODS and BOMB with top-level `const`. In a
 * classic script that is a global LEXICAL binding, not a window property, so a
 * campaign manifest can only replace window.FOODS / window.BOMB. The engine
 * once read the bare names and kept throwing the built-in McDonald's roster on
 * every tenant page (/play/<slug>/) while window.FOODS held the tenant's menu.
 *
 * Checked statically because the spawner cannot be driven in a browser test
 * here (headless rAF is throttled — see CLAUDE.md), and the bug is exactly a
 * name-resolution one. */
const source = readFileSync(new URL('../../engine/game.js', import.meta.url), 'utf8');

/** Source with comments and string literals blanked, so prose can't match. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, "''");
}

describe('engine roster', () => {
  it.each(['FOODS', 'BOMB'])('never reads the bare %s binding, only the window property', (name) => {
    const bare = new RegExp(`(?<![.\\w$])${name}(?![\\w$])`, 'g');
    expect(code(source).match(bare) ?? []).toEqual([]);
  });

  it('reloads sprites when a round starts, after a tenant manifest may have landed', () => {
    const start = code(source).match(/function startGame\(\)\s*\{([\s\S]*?)\n {2}\}/);
    expect(start?.[1]).toMatch(/preloadSprites\(\)/);
  });
});
