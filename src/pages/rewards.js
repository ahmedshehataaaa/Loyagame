/* Rewards Catalog — Stitch "McSlice Rush - Rewards Catalog".
   Points header + rank tier + progress to next tier, a card grid
   built from typed data, and a redeemed-history list. */
import {
  el,
  button,
  topbar,
  meter,
  tabbar,
  toast,
  fmt,
  modal,
  emptyState,
} from '../components/ui.js';
import { REWARDS, tierFor } from '../data/catalog.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';

export function RewardsPage(root) {
  const wrap = el('div', { class: 'screen bg-burst' });
  const listHost = el('div');

  function state(reward, progress) {
    if (progress.redeemedRewardIds.includes(reward.id)) return 'owned';
    if (progress.rewardPoints < reward.cost) return 'locked';
    return 'available';
  }

  function confirmRedeem(reward) {
    const overlay = modal({
      title: `Redeem ${reward.name}?`,
      body: `This spends ${fmt(reward.cost)} points. Show the code at the counter to claim it.`,
      actions: [
        button('Yes, redeem', {
          onClick: () => {
            const res = Store.redeem(reward);
            overlay.remove();
            if (res.ok) {
              toast(`${reward.name} redeemed!`, 'ok');
              paint();
            } else if (res.error === 'insufficient_points') toast('Not enough points yet.', 'bad');
            else if (res.error === 'already_redeemed') toast('Already redeemed.', 'bad');
            else toast('That reward is unavailable.', 'bad');
          },
        }),
        button('Cancel', { variant: 'ghost', onClick: () => overlay.remove() }),
      ],
      onClose: () => overlay.remove(),
    });
    wrap.append(overlay);
  }

  function rewardCard(reward, progress) {
    const st = state(reward, progress);
    const card = el(
      'button',
      {
        class: `reward reward--${st === 'available' ? 'ready' : st}`,
        type: 'button',
        disabled: st !== 'available',
        'aria-label': `${reward.name}, ${fmt(reward.cost)} points, ${
          st === 'owned' ? 'already redeemed' : st === 'locked' ? 'locked' : 'available to redeem'
        }`,
        onClick: () => st === 'available' && confirmRedeem(reward),
      },
      el('span', { class: 'reward__cost', text: `${fmt(reward.cost)} PTS` }),
      st === 'owned' && el('span', { class: 'reward__flag', 'aria-hidden': 'true', text: '✓' }),
      st === 'locked' && el('span', { class: 'reward__flag', 'aria-hidden': 'true', text: '🔒' }),
      el(
        'span',
        { class: 'reward__art' },
        el('img', {
          src: reward.art,
          alt: '',
          loading: 'lazy',
          width: '84',
          height: '84',
          onError: (e) => {
            e.target.replaceWith(el('span', { text: '🍔', style: { fontSize: '38px' } }));
          },
        }),
      ),
      el('span', { class: 'reward__name', text: reward.name }),
      el('span', { class: 'reward__desc', text: reward.desc }),
    );
    return card;
  }

  function paint() {
    const progress = Store.progress();
    const { current, next } = tierFor(progress.rewardPoints);
    const redeemed = REWARDS.filter((r) => progress.redeemedRewardIds.includes(r.id));

    listHost.innerHTML = '';
    listHost.append(
      el(
        'section',
        { class: 'card points-head' },
        el(
          'div',
          { class: 'points-head__row' },
          el(
            'div',
            null,
            el('span', { class: 't-kicker', text: 'Total points' }),
            el('b', { class: 'points-head__value', text: fmt(progress.rewardPoints) }),
          ),
          el('span', { class: 'rank-chip', text: `RANK: ${current.name.toUpperCase()}` }),
        ),
        meter(progress.rewardPoints, next ? next.min : Math.max(progress.rewardPoints, 1), {
          hint: next ? `NEXT TIER: ${fmt(next.min)}` : 'MAX TIER REACHED',
        }),
      ),

      el('h2', { class: 't-kicker section-head', text: 'Rewards you can claim' }),
      el('div', { class: 'reward-grid' }, ...REWARDS.map((r) => rewardCard(r, progress))),

      el('h2', { class: 't-kicker section-head', text: 'Redeemed' }),
      redeemed.length
        ? el(
            'ul',
            { class: 'lb-list' },
            ...redeemed.map((r) =>
              el(
                'li',
                { class: 'lb-row' },
                el('img', { class: 'lb-row__avatar', src: r.art, alt: '', loading: 'lazy' }),
                el('span', { class: 'lb-row__name' }, el('span', { text: r.name })),
                el('span', { class: 'tag-you', text: 'CLAIMED' }),
              ),
            ),
          )
        : emptyState(
            '🎟️',
            'Nothing redeemed yet',
            'Win rounds to bank points, then claim a reward here.',
          ),
    );
  }

  wrap.append(
    topbar('Rewards', { back: '/' }),
    listHost,
    el(
      'div',
      { style: { marginTop: 'auto', paddingTop: '18px' } },
      button('▶ Play a round', { onClick: () => navigate('/play') }),
    ),
  );
  paint();
  root.append(wrap, tabbar('/rewards'));
}
