import globals from 'globals';
import react from 'eslint-plugin-react';

/* The codebase is three distinct JS dialects that must not be linted alike:
   engine/ are classic browser scripts sharing implicit globals, src/ are
   browser ES modules, api/ + netlify/ are Node serverless modules. Splitting
   the config is what lets `no-undef` stay on everywhere. */
export default [
  {
    ignores: [
      '_legacy-ui-backup/**', // retired, not shipped — see docs/audit
      'stitch-export/**', // generated design exports
      '.vercel.krispy-kreme-link.bak/**',
      'node_modules/**',
      // Build output: minified, generated, and not ours to style.
      'dist/**',
      'test-results/**',
      'playwright-report/**',
      '.playwright-mcp/**',
    ],
  },

  {
    // Shared baseline.
    languageOptions: { ecmaVersion: 2023 },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': ['error', { boolean: false }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  {
    // Canvas engine — classic scripts, globals shared across files.
    files: ['engine/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        CONFIG: 'readonly',
        BRAND: 'readonly',
        FOODS: 'readonly',
        BOMB: 'readonly',
        SPECIALS: 'readonly',
        DISCOUNT_TIERS: 'readonly',
        Platform: 'readonly',
        Sound: 'readonly',
        Game: 'readonly',
        UI: 'readonly',
        LoyaltyData: 'readonly',
        // Published by src/game/index.js before the engine is ever ticked.
        Mechanics: 'readonly',
      },
    },
  },

  {
    // Service worker — its own global scope, not a window.
    files: ['sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },

  {
    // Claude Code hooks are CommonJS Node scripts, not app code.
    files: ['.claude/hooks/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  {
    // App shell — real ES modules.
    files: ['src/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },

  {
    // Serverless functions.
    files: ['api/**/*.mjs', 'netlify/**/*.mjs', 'lib/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },

  {
    /* Admin dashboard — the one React surface in the repo (ADR 0017). A FOURTH
       dialect, kept isolated from src/ on purpose: JSX needs a parser option
       the rest of the codebase must not get, and React's component functions
       are `no-undef`-clean only once JSX is understood. */
    files: ['dashboard/**/*.jsx', 'dashboard/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: { react },
    rules: {
      /* Without this, `no-unused-vars` cannot see that <Card /> uses the
         imported `Card` — every component import in the tree reads as dead.
         Enabling the one rule keeps no-unused-vars ON and honest here, which
         is far better than switching it off for the whole directory. */
      'react/jsx-uses-vars': 'error',
    },
  },

  {
    // Test + tooling files.
    files: ['tests/**/*.js', '*.config.js', '*.config.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },

  {
    /* Build/CI scripts. These are CLIs, so stdout IS their interface. Browser
       globals are allowed too: perf-baseline.mjs drives Playwright and its
       page.evaluate() callbacks are authored inline here but RUN in the page. */
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { 'no-console': 'off', 'no-implicit-coercion': 'off' },
  },
];
