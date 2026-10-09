import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shareCardHtml, absoluteAsset } from '../../lib/share-card.mjs';

const manifest = {
  brand: { name: "Jimmy's Pizzeria", gameName: "Jimmy's Slice Master", tagline: 'Slice the pizzas', logo: 'https://cdn.example.com/jp.png', colors: { primary: '#883736' } },
};

describe('tenant link-preview card', () => {
  it('names the tenant, not McDonald’s', () => {
    const html = shareCardHtml({ origin: 'https://loyagame.vercel.app', slug: 'jimmys-pizzeria', name: "Jimmy's", manifest });
    expect(html).toContain('<meta property="og:title" content="Jimmy&#39;s Slice Master · Jimmy&#39;s Pizzeria">');
    expect(html).toContain('og:image" content="https://cdn.example.com/jp.png"');
    expect(html).toContain('og:url" content="https://loyagame.vercel.app/play/jimmys-pizzeria/"');
    expect(html).not.toMatch(/McSlice|McDonald/);
  });
  it('escapes brand copy', () => {
    const html = shareCardHtml({ origin: 'https://x.app', slug: 's', name: 'n', manifest: { brand: { name: '<script>alert(1)</script>' } } });
    expect(html).not.toContain('<script>');
  });
  it('makes relative logos absolute and falls back to the icon', () => {
    expect(absoluteAsset('https://x.app', 'assets/logo.png')).toBe('https://x.app/assets/logo.png');
    expect(absoluteAsset('https://x.app', '')).toBe('https://x.app/icon.svg');
  });
  it('routes crawlers only — never in-app browsers', () => {
    const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
    const rule = cfg.rewrites.find((r) => r.has && r.destination.includes('share=1'));
    const re = new RegExp(`^${rule.has[0].value}$`);
    for (const bot of ['WhatsApp/2.23.20.0 A', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'TelegramBot (like TwitterBot)', 'Mozilla/5.0 (compatible; Discordbot/2.0)'])
      expect(re.test(bot), bot).toBe(true);
    for (const human of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36 [FBAN/FB4A;FBAV/440.0]',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120 Mobile Safari/537.36 Pinterest/Android',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ])
      expect(re.test(human), human).toBe(false);
    // the crawler rule must come before the catch-all player rewrite
    const idx = cfg.rewrites.indexOf(rule), player = cfg.rewrites.findIndex((r) => !r.has && r.destination === '/index.html');
    expect(idx).toBeLessThan(player);
  });
});
