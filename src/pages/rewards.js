/* Prizes — Stitch "McSlice Rush - Rewards Catalog", root build only.
   The Stitch layout (points header, art grid) now shows what the prize wheel
   can actually land on. It used to be a points shop: 500 PTS for fries, 1,000
   for a Big Mac. Those points never existed (the wheel is the only way to win)
   and every redeem ended in "not available in-app yet", so the screen
   contradicted the game. The prizes, odds and score gate are read from
   CONFIG.WHEEL, the same mirror the wheel, terms and wallet use. */
import { el, button, topbar, meter, fmt } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { pointsThreshold, prizes } from '../core/rules.js';

/* Item art for the food prizes, matched on the label so a relabelled prize
   falls back to the gift icon rather than showing the wrong food. */
/** @type {[RegExp, string][]} */
const ART = [
  [/fries/i, 'assets/items/fries.png'],
  [/big ?mac/i, 'assets/items/bigmac.png'],
  [/mcflurry/i, 'assets/items/mcflurry.png'],
  [/apple pie/i, 'assets/items/applepie.png'],
  [/nugget/i, 'assets/items/nuggets.png'],
  [/hash ?brown/i, 'assets/items/hashbrown.png'],
  [/filet/i, 'assets/items/filetofish.png'],
];

/** Weight is a percentage (the ladder sums to 100); say it as rarity. */
function rarity(weight) {
  if (weight >= 12) return 'Common';
  if (weight >= 4) return 'Rare';
  return 'Ultra rare';
}

export function RewardsPage(root) {
  const wrap = el('div', { class: 'screen bg-burst' });
  const threshold = pointsThreshold();
  const best = Store.progress().bestScore || 0;
  const list = prizes();
  const top = list.reduce((a, p) => (!a || p.weight < a.weight ? p : a), null);

  function prizeCard(p) {
    const art = ART.find(([re]) => re.test(p.label))?.[1];
    const pct = /(\d+)%\s*off/i.exec(p.label);
    const isTop = p === top;
    return el(
      'div',
      {
        class: `reward reward--ready${isTop ? ' reward--active' : ''}`,
        role: 'listitem',
        'aria-label': `${p.label}, ${rarity(p.weight).toLowerCase()}`,
      },
      el('span', { class: 'reward__cost', text: rarity(p.weight).toUpperCase() }),
      isTop && el('span', { class: 'reward__ribbon', text: 'TOP PRIZE' }),
      el(
        'span',
        { class: 'reward__art' },
        art
          ? el('img', {
              src: art,
              alt: '',
              loading: 'lazy',
              width: '84',
              height: '84',
              onError: (e) => e.target.replaceWith(icon('gift', { size: 38 })),
            })
          : pct
            ? el('b', { class: 'reward__pct', text: `${pct[1]}%` })
            : icon('gift', { size: 38 }),
      ),
      el('span', {
        class: 'reward__name',
        text: pct ? `${pct[1]}% off` : p.label.replace(/^free\s+/i, ''),
      }),
      el('span', { class: 'reward__desc', text: pct ? 'Your whole order' : 'Free, on the house' }),
    );
  }

  wrap.append(
    topbar('Prizes', { back: '/' }),
    el(
      'section',
      { class: 'card points-head' },
      el(
        'div',
        { class: 'points-head__row' },
        el(
          'div',
          null,
          el('span', { class: 't-kicker', text: 'Spin the wheel at' }),
          el('b', { class: 'points-head__value', text: fmt(threshold) }),
        ),
      ),
      meter(Math.min(best, threshold), threshold, {
        hint:
          best >= threshold
            ? `YOUR BEST ${fmt(best)} — SURVIVE WITH ${fmt(threshold)}+ TO SPIN`
            : `YOUR BEST ${fmt(best)} — LAST THE FULL ROUND WITH ${fmt(threshold)}+`,
      }),
    ),
    el('h2', { class: 't-kicker section-head', text: 'What the wheel can land on' }),
    el('div', { class: 'reward-grid prize-grid', role: 'list' }, ...list.map(prizeCard)),
    el(
      'div',
      { class: 'prizes__actions' },
      button('Play a round', {
        icon: icon('play', { size: 15 }),
        onClick: () => navigate('/play'),
      }),
      button('My prizes', { variant: 'ghost', onClick: () => navigate('/wallet') }),
    ),
  );
  root.append(wrap);
}
