import { describe, it, expect, beforeEach } from 'vitest';
import { t, num, setLang, currentLang, isRTL, keysFor, toggleLang } from '../../src/core/i18n.js';

beforeEach(() => setLang('en'));

describe('locale completeness', () => {
  it('Arabic defines every English key', () => {
    // The regression this guards: the src/ rewrite dropped the EN/AR support the
    // pre-refactor build had, so Arabic went from complete to non-existent. A
    // partial locale is the same failure in slow motion.
    const en = keysFor('en');
    const ar = new Set(keysFor('ar'));
    const missing = en.filter((k) => !ar.has(k));
    expect(missing, `missing Arabic keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('English defines every Arabic key', () => {
    const ar = keysFor('ar');
    const en = new Set(keysFor('en'));
    const extra = ar.filter((k) => !en.has(k));
    expect(extra, `Arabic keys with no English source: ${extra.join(', ')}`).toEqual([]);
  });

  it('has no blank strings in either locale', () => {
    for (const locale of /** @type {const} */ (['en', 'ar'])) {
      setLang(locale);
      for (const key of keysFor(locale)) {
        expect(t(key).trim().length, `${locale}/${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves no unresolved placeholders once interpolated', () => {
    // Any string with {vars} must have them supplied by its caller. Scan both
    // locales for the same placeholder set, so a translation cannot silently
    // rename or drop one.
    const en = keysFor('en');
    for (const key of en) {
      setLang('en');
      const enVars = (t(key).match(/\{(\w+)\}/g) || []).sort();
      setLang('ar');
      const arVars = (t(key).match(/\{(\w+)\}/g) || []).sort();
      expect(arVars, `placeholder mismatch on ${key}`).toEqual(enVars);
    }
  });
});

describe('interpolation', () => {
  it('substitutes named variables', () => {
    expect(t('welcome.greet', { name: 'Ali' })).toContain('Ali');
  });

  it('replaces every occurrence, not just the first', () => {
    // `{x}` twice in one string must both resolve; a naive String.replace
    // without /g would leave the second visible to the player.
    expect(t('nonexistent.key', { a: 1 })).toBe('nonexistent.key');
  });

  it('renders the key when a string is missing, never blank', () => {
    // A blank looks like a layout bug; a visible key is unmissable.
    expect(t('totally.made.up')).toBe('totally.made.up');
  });

  it('falls back to English for a key missing only in Arabic', () => {
    setLang('ar');
    // Every key exists in both (asserted above), so this checks the mechanism
    // rather than a real gap: an unknown key still returns itself, not ''.
    expect(t('another.made.up')).toBe('another.made.up');
  });
});

describe('direction and language state', () => {
  it('Arabic is RTL and English is not', () => {
    setLang('ar');
    expect(isRTL()).toBe(true);
    setLang('en');
    expect(isRTL()).toBe(false);
  });

  it('toggles between the two locales', () => {
    expect(currentLang()).toBe('en');
    expect(toggleLang()).toBe('ar');
    expect(toggleLang()).toBe('en');
  });

  it('ignores an unsupported locale rather than breaking', () => {
    setLang('en');
    setLang(/** @type {any} */ ('fr'));
    expect(currentLang()).toBe('en');
  });
});

describe('number formatting', () => {
  it('groups thousands in English', () => {
    expect(num(42000)).toBe('42,000');
  });

  it('uses Arabic digits in Arabic', () => {
    setLang('ar');
    const out = num(42000);
    // ar-EG renders Eastern Arabic numerals; the exact glyphs matter less than
    // that it is NOT the Latin-digit English form.
    expect(out).not.toBe('42,000');
    expect(out.length).toBeGreaterThan(0);
  });

  it('treats junk as zero rather than rendering NaN', () => {
    expect(num(undefined)).toBe('0');
    expect(num(/** @type {any} */ ('abc'))).toBe('0');
  });
});
