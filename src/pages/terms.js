/* ============================================================
   Terms & eligibility.

   A stable, linkable URL, which is the whole reason this is a route and
   not a modal: a compliance page has to be referenceable from a receipt,
   a poster QR code or a legal review, and it must survive a refresh.

   Written in plain language and generated from the LIVE config, so the
   round length, lives and points threshold it states cannot drift away
   from what the game actually does — a terms page that contradicts the
   game is worse than none.

   This is a player-facing summary, NOT a substitute for the campaign's
   legal terms. The prize-odds section exists because the reward wheel is
   a weighted random draw (ADR 0008) with an open compliance question; see
   docs/security/reward-wheel-compliance.md.
   ============================================================ */
import { el, topbar, tabbar } from '../components/ui.js';
import { t, num } from '../core/i18n.js';
import { roundSeconds, startLives, pointsThreshold, prizes } from '../core/rules.js';

/** A titled block. Keeps the section rhythm identical down the page. */
const section = (headingKey, bodyText) =>
  el(
    'section',
    { class: 'terms__section' },
    el('h2', { class: 'terms__h', text: t(headingKey) }),
    el('p', { class: 'terms__p', text: bodyText }),
  );

export function TermsPage(root) {
  /* Read at render time, not module load: a terms page that states different
     rules from the running campaign is worse than none. */
  const ROUND_TIME = roundSeconds();
  const START_LIVES = startLives();
  const THRESHOLD = pointsThreshold();

  const wrap = el('div', { class: 'screen bg-burst' });
  const prizeList = prizes().map((p) => el('li', { text: p.label }));

  wrap.append(
    topbar(t('terms.title'), { back: '/' }),

    el(
      'div',
      { class: 'terms' },
      el('p', { class: 'terms__intro', text: t('terms.intro') }),

      section('terms.eligibilityH', t('terms.eligibilityB')),
      section('terms.rulesH', t('terms.rulesB', { seconds: ROUND_TIME, lives: num(START_LIVES) })),
      section('terms.prizeH', t('terms.prizeB', { threshold: num(THRESHOLD) })),
      section('terms.oddsH', t('terms.oddsB')),

      // The actual prize set, straight from config so it cannot go stale.
      prizeList.length ? el('ul', { class: 'terms__list' }, ...prizeList) : null,

      section('terms.dataH', t('terms.dataB')),
      section('terms.redeemH', t('terms.redeemB')),
      section('terms.contactH', t('terms.contactB')),
    ),
  );

  root.append(wrap, tabbar('/'));
}
