/* ============================================================
   My Rewards — the prize wallet.

   Shows prizes the SERVER issued, with everything a player needs to
   actually use one: what it is, its state, how to redeem it, and that it
   is single-use.

   Prize history is server-side (`wheel_wins`), so this screen is honest
   about what it can and cannot show. The only prize it knows about
   client-side is the one from the round just played, held in memory. It
   does not persist prizes to localStorage: a cached prize rehydrated on a
   later visit is exactly how a player ends up at a till holding something
   that was never issued to them.
   ============================================================ */
import { el, button, topbar, emptyState, toast } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { t, num } from '../core/i18n.js';
import { REWARD_STATUS } from '../services/reward-state.js';
import { pointsThreshold, scoreGated } from '../core/rules.js';
import { track, EVENTS } from '../analytics/index.js';
import { fetchWallet } from '../services/loyalty.js';

/** An ISO date as the player's own calendar date, or null. */
function day(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(document.documentElement.lang || 'en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** One issued prize. */
function prizeCard(prize, { redeemed = false, expires = null, code = null } = {}) {
  return el(
    'article',
    { class: `wallet-card${redeemed ? ' is-redeemed' : ''}` },
    el(
      'header',
      { class: 'wallet-card__head' },
      el('span', { class: 't-kicker', text: t('reward.yours') }),
      el('span', {
        class: `wallet-card__state${redeemed ? '' : ' is-active'}`,
        text: redeemed ? t('wallet.redeemed') : t('wallet.active'),
      }),
    ),

    el('p', { class: 'wallet-card__prize', text: prize.label }),

    // The code is what staff check against the server; without it the card
    // cannot be redeemed at all. Only ever the server's own string.
    code
      ? el(
          'p',
          { class: 'wallet-card__code' },
          el('span', { class: 't-kicker', text: t('wallet.code') }),
          el('b', { text: code }),
        )
      : null,

    el(
      'dl',
      { class: 'wallet-card__meta' },
      el('dt', {
        text: t('wallet.expires', { date: '' }).replace('{date}', '').trim() || 'Expiry',
      }),
      // The label already says "Expires"; the value is just the date.
      el('dd', { text: expires ?? t('wallet.noExpiry') }),
    ),

    el('p', { class: 'wallet-card__hint', text: t('wallet.showStaff') }),

    // Redemption is a staff action against the server (redeem_wheel_win). The
    // app must not offer a button that looks like it grants the prize.
    button(t('wallet.counterOnly'), {
      variant: 'ghost',
      size: 'sm',
      disabled: true,
      onClick: () => toast(t('wallet.counterOnly'), 'bad'),
    }),
  );
}

export function WalletPage(root) {
  const wrap = el('div', { class: 'screen bg-burst' });
  const last = Store.lastReward();

  const body = el('div', { class: 'wallet' });

  // Points header — the gate on every future prize, so it belongs here.
  const pts = Store.progress().rewardPoints;
  const need = pointsThreshold();
  const byScore = scoreGated();
  body.append(
    byScore
      ? /* Score-gated: there is no balance to show — the bar is per round. */
        el(
          'section',
          { class: 'card points-head' },
          el(
            'div',
            { class: 'points-head__row' },
            el(
              'div',
              null,
              el('span', { class: 't-kicker', text: t('reward.spinAt') }),
              el('b', { class: 'points-head__value', text: num(need) }),
            ),
          ),
          el('p', {
            class: 't-muted',
            style: { fontSize: '13px', marginTop: '6px' },
            text: t('wallet.scoreGoal'),
          }),
        )
      : el(
          'section',
          { class: 'card points-head' },
          el(
            'div',
            { class: 'points-head__row' },
            el(
              'div',
              null,
              el('span', { class: 't-kicker', text: t('reward.pointsLabel') }),
              el('b', { class: 'points-head__value', text: num(pts) }),
            ),
            el('span', { class: 'rank-chip', text: `/ ${num(need)}` }),
          ),
          el('p', {
            class: 't-muted',
            style: { fontSize: '13px', marginTop: '6px' },
            text:
              pts >= need
                ? t('reward.pointsEnough')
                : t('reward.pointsShort', { short: num(Math.max(0, need - pts)) }),
          }),
        ),
  );

  /* The list comes from the server: prizes this phone won on this device.
     `lastReward` (this session's win, kept in memory only) is the fallback
     when the server cannot be reached, so a fresh win is never hidden. */
  const list = el('div', { class: 'wallet__list' });
  const loading = el('p', { class: 'wallet__note t-muted', text: t('wallet.loading') });
  list.append(loading);
  body.append(list);

  const empty = () =>
    emptyState(
      icon('gift', { size: 40 }),
      t('wallet.empty'),
      byScore ? t('wallet.emptyBodyScore', { threshold: num(need) }) : t('wallet.emptyBody'),
      el(
        'div',
        { style: { marginTop: '14px', width: '220px' } },
        button(t('common.playNow'), { onClick: () => navigate('/play') }),
      ),
    );

  const lastCard = () => {
    if (!(last && last.status === REWARD_STATUS.AWARDED && last.prize)) return null;
    track(EVENTS.REWARD_VIEWED, { prizeKey: last.prize.key, status: last.status });
    return prizeCard(last.prize, { code: last.code });
  };

  fetchWallet().then((res) => {
    if (!list.isConnected && !wrap.isConnected) return;
    if (res.ok) {
      const cards = res.wins.map((w) =>
        prizeCard(w.prize, { redeemed: w.redeemed, expires: day(w.expiresAt), code: w.code }),
      );
      if (cards.length)
        track(EVENTS.REWARD_VIEWED, { prizeKey: res.wins[0].prize.key, status: 'awarded' });
      list.replaceChildren(...(cards.length ? cards : [lastCard() ?? empty()]));
      return;
    }
    // Signed out: nothing to load, and no failure to report.
    const fallback = lastCard() ?? empty();
    list.replaceChildren(
      ...[
        fallback,
        'kind' in res && res.kind === 'no_identity'
          ? null
          : el('p', { class: 'wallet__note t-muted', text: t('wallet.serverNote') }),
      ].filter((n) => n instanceof Node),
    );
  });

  body.append(
    el(
      'div',
      { style: { marginTop: '10px' } },
      button(t('common.terms'), {
        variant: 'ghost',
        size: 'sm',
        onClick: () => navigate('/terms'),
      }),
    ),
  );

  wrap.append(topbar(t('wallet.title'), { back: '/' }), body);
  root.append(wrap);
}
