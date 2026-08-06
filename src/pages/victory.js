/* You Won! — Stitch "McSlice Rush - You Won!".
   Every figure comes from the recorded run, never the mockup. */
import { el, button, tabbar, fmt, emptyState } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';

export function VictoryPage(root) {
  const run = Store.progress().lastRun;

  // Reached directly (refresh / deep link) with no completed round.
  if (!run) {
    root.append(el('div', { class: 'screen bg-burst' },
      emptyState('🎮', 'No round to show', 'Play a round first — your results will land here.',
        el('div', { style: { marginTop: '14px', width: '220px' } },
          button('Play now', { onClick: () => navigate('/play') })))),
      tabbar('/'));
    return;
  }

  const profile = Store.profile();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Confetti is decorative only, and skipped when reduced motion is on.
  const confetti = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  if (!reduced) {
    const colors = ['#FFC72C', '#ffffff', '#FF8C00', '#ffe9a8'];
    for (let i = 0; i < 34; i++) {
      confetti.append(el('i', {
        style: {
          left: `${Math.random() * 100}%`,
          background: colors[(Math.random() * colors.length) | 0],
          animationDelay: `${-Math.random() * 3}s`,
          animationDuration: `${2.4 + Math.random() * 2}s`,
        },
      }));
    }
  }

  root.append(el('div', { class: 'screen bg-burst victory' },
    confetti,
    el('div', { class: 'victory__head' },
      el('h1', { class: 't-display victory__title', text: 'You Won!' }),
      el('p', { class: 't-muted', text: profile ? `Great slicing, ${profile.name}` : 'Great slicing!' }),
    ),

    el('section', { class: 'card victory__card' },
      el('span', { class: 't-kicker', text: 'Final score' }),
      el('b', { class: 'victory__score', text: fmt(run.score) }),
      run.isBest && el('span', { class: 'victory__badge', text: '🏆 NEW PERSONAL BEST' }),

      el('div', { class: 'victory__grid' },
        el('div', { class: 'victory__cell' },
          el('b', { text: fmt(run.itemsSliced) }), el('small', { text: 'ITEMS SLICED' })),
        el('div', { class: 'victory__cell' },
          el('b', { text: `+${fmt(run.earned)}` }), el('small', { text: 'POINTS EARNED' })),
        el('div', { class: 'victory__cell' },
          el('b', { text: fmt(Store.progress().rewardPoints) }), el('small', { text: 'TOTAL POINTS' })),
      ),
    ),

    el('div', { class: 'victory__actions' },
      button('Play Again', { icon: '▶', onClick: () => navigate('/play') }),
      button('View Rewards', { variant: 'ghost', onClick: () => navigate('/rewards') }),
      el('div', { class: 'welcome__links' },
        button('Leaderboard', { variant: 'ghost', size: 'sm', onClick: () => navigate('/leaderboard') }),
        button('Home', { variant: 'ghost', size: 'sm', onClick: () => navigate('/') }),
      ),
    ),
  ), tabbar('/'));
}
