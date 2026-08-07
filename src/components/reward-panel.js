/* ============================================================
   Reward panel — renders a RewardOutcome.

   The only component allowed to display a prize, and it can only display
   what `outcome.prize` contains. It has no access to the API, no fallback
   copy that names a product, and no branch that invents a prize when one
   is missing — every non-award state renders the outcome's own title and
   message, which reward-state.js supplied.

   Keeping this dumb is the point: if the panel cannot construct a prize,
   then a bug elsewhere cannot make one appear on screen.
   ============================================================ */
import { el, button, fmt } from './ui.js';
import { REWARD_STATUS } from '../services/reward-state.js';

/** Progress toward the points needed for a prize, when the server told us. */
function pointsRow(outcome) {
  const { orderPoints: pts, pointsThreshold: need } = outcome;
  if (!Number.isFinite(pts) || !Number.isFinite(need) || need <= 0) return null;
  const short = Math.max(0, need - pts);
  return el(
    'div',
    { class: 'reward-panel__points' },
    el('span', { class: 't-kicker', text: 'ORDER POINTS' }),
    el('b', { text: `${fmt(pts)} / ${fmt(need)}` }),
    short > 0
      ? el('small', { text: `${fmt(short)} more to unlock a prize — earned by ordering.` })
      : el('small', { text: 'Enough for a prize.' }),
  );
}

/**
 * @param {import('../services/reward-state.js').RewardOutcome} outcome
 * @param {{onRetry?:()=>void, onWallet?:()=>void}} [handlers]
 */
export function rewardPanel(outcome, handlers = {}) {
  if (!outcome) return null;

  const awarded = outcome.status === REWARD_STATUS.AWARDED && !!outcome.prize;

  return el(
    'section',
    {
      class: `reward-panel reward-panel--${outcome.status}`,
      role: 'status',
      'aria-live': 'polite',
    },

    el('span', { class: 't-kicker', text: awarded ? 'YOUR PRIZE' : 'REWARD' }),
    el('p', { class: 'reward-panel__title', text: outcome.title }),

    // The prize name comes from the server's response and nowhere else.
    awarded
      ? el('p', { class: 'reward-panel__prize', text: outcome.prize.label })
      : el('p', { class: 'reward-panel__msg', text: outcome.message }),

    awarded
      ? el('p', {
          class: 'reward-panel__hint',
          text: 'Saved to My Rewards. Show it at the counter to claim.',
        })
      : null,

    pointsRow(outcome),

    // Retry is offered only where retrying can actually change the answer —
    // never for a denial, which would just re-ask a settled question.
    outcome.retryable && handlers.onRetry
      ? el(
          'div',
          { class: 'reward-panel__actions' },
          button('Check again', { variant: 'ghost', size: 'sm', onClick: handlers.onRetry }),
        )
      : null,

    awarded && handlers.onWallet
      ? el(
          'div',
          { class: 'reward-panel__actions' },
          button('View My Rewards', { variant: 'ghost', size: 'sm', onClick: handlers.onWallet }),
        )
      : null,
  );
}
