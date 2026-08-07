/* ============================================================
   Reward panel — renders a RewardOutcome.

   The only component allowed to display a prize, and it can only display
   what `outcome.prize` contains. It has no access to the API and no branch
   that invents a prize when one is missing — every non-award state renders
   copy looked up from i18n by status, so a new status without copy shows
   its key rather than an empty card.

   Keeping this dumb is the point: if the panel cannot construct a prize,
   a bug elsewhere cannot make one appear on screen.
   ============================================================ */
import { el, button } from './ui.js';
import { REWARD_STATUS } from '../services/reward-state.js';
import { t, num } from '../core/i18n.js';

/** Progress toward the points needed for a prize, when the server told us. */
function pointsRow(outcome) {
  const { orderPoints: pts, pointsThreshold: need } = outcome;
  if (!Number.isFinite(pts) || !Number.isFinite(need) || need <= 0) return null;
  const short = Math.max(0, need - pts);
  return el(
    'div',
    { class: 'reward-panel__points' },
    el('span', { class: 't-kicker', text: t('reward.pointsLabel') }),
    el('b', { text: `${num(pts)} / ${num(need)}` }),
    el('small', {
      text: short > 0 ? t('reward.pointsShort', { short: num(short) }) : t('reward.pointsEnough'),
    }),
  );
}

/**
 * @param {import('../services/reward-state.js').RewardOutcome} outcome
 * @param {{onRetry?:()=>void, onWallet?:()=>void}} [handlers]
 */
export function rewardPanel(outcome, handlers = {}) {
  if (!outcome) return null;

  const awarded = outcome.status === REWARD_STATUS.AWARDED && !!outcome.prize;
  const title = t(`reward.${outcome.status}.title`);
  const message = t(`reward.${outcome.status}.msg`);

  return el(
    'section',
    {
      class: `reward-panel reward-panel--${outcome.status}`,
      role: 'status',
      'aria-live': 'polite',
    },

    el('span', { class: 't-kicker', text: awarded ? t('reward.yours') : t('reward.label') }),
    el('p', { class: 'reward-panel__title', text: title }),

    // The prize name comes from the server's response and nowhere else.
    awarded
      ? el('p', { class: 'reward-panel__prize', text: outcome.prize.label })
      : el('p', { class: 'reward-panel__msg', text: message }),

    awarded ? el('p', { class: 'reward-panel__hint', text: t('reward.savedHint') }) : null,

    pointsRow(outcome),

    // Retry is offered only where retrying can change the answer — never for a
    // denial, which would just re-ask a settled question.
    outcome.retryable && handlers.onRetry
      ? el(
          'div',
          { class: 'reward-panel__actions' },
          button(t('reward.checkAgain'), {
            variant: 'ghost',
            size: 'sm',
            onClick: handlers.onRetry,
          }),
        )
      : null,

    awarded && handlers.onWallet
      ? el(
          'div',
          { class: 'reward-panel__actions' },
          button(t('reward.viewWallet'), {
            variant: 'ghost',
            size: 'sm',
            onClick: handlers.onWallet,
          }),
        )
      : null,
  );
}
