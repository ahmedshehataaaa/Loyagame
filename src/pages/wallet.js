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
import { el, button, topbar, tabbar, emptyState, toast } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { t, num } from '../core/i18n.js';
import { REWARD_STATUS } from '../services/reward-state.js';
import { pointsThreshold } from '../core/rules.js';

/** One issued prize. */
function prizeCard(prize, { redeemed = false, expires = null } = {}) {
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

    el(
      'dl',
      { class: 'wallet-card__meta' },
      el('dt', {
        text: t('wallet.expires', { date: '' }).replace('{date}', '').trim() || 'Expiry',
      }),
      el('dd', { text: expires ? t('wallet.expires', { date: expires }) : t('wallet.noExpiry') }),
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
  body.append(
    el(
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

  if (last && last.status === REWARD_STATUS.AWARDED && last.prize) {
    body.append(prizeCard(last.prize));
  } else {
    body.append(
      emptyState(
        '🎁',
        t('wallet.empty'),
        t('wallet.emptyBody'),
        el(
          'div',
          { style: { marginTop: '14px', width: '220px' } },
          button(t('common.playNow'), { onClick: () => navigate('/play') }),
        ),
      ),
    );
  }

  // Say plainly that full history is server-side rather than implying this
  // list is complete.
  body.append(
    el('p', { class: 'wallet__note t-muted', text: t('wallet.serverNote') }),
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
  root.append(wrap, tabbar('/wallet'));
}
