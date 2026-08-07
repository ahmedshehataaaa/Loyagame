/* Pro Leaderboard — Stitch "McSlice Rush - Pro Leaderboard".
   Season countdown, medal ranks, and the signed-in player merged in
   and highlighted. Rival rows are seeded prototype data (see
   data/catalog.js); the player's row is their real best score. */
import { el, button, topbar, tabbar, fmt, emptyState, loadingState } from '../components/ui.js';
import { RIVALS } from '../data/catalog.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Stands in for a ranked endpoint; async so the loading/error states are real. */
function fetchStandings() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(RIVALS.slice());
      } catch {
        reject(new Error('standings_unavailable'));
      }
    }, 220);
  });
}

function seasonRemaining() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  // getTime() rather than relying on Date arithmetic coercion — the implicit
  // Date-minus-Date works at runtime but is not type-safe and hides intent.
  let ms = Math.max(0, end.getTime() - now.getTime());
  const d = Math.floor(ms / 86400000);
  ms -= d * 86400000;
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  return `${d}d ${h}h ${m}m`;
}

export function LeaderboardPage(root) {
  const listHost = el('div', null, loadingState('Loading standings…'));
  const clockEl = el('b', { class: 'season__clock', text: seasonRemaining() });
  const tick = setInterval(() => {
    clockEl.textContent = seasonRemaining();
  }, 30000);

  root.append(
    el(
      'div',
      { class: 'screen bg-burst' },
      topbar('Standings', { back: '/' }),
      el(
        'section',
        { class: 'card season' },
        el('span', { class: 't-kicker', text: 'Season ends in' }),
        clockEl,
      ),
      listHost,
      el(
        'div',
        { style: { marginTop: 'auto', paddingTop: '18px' } },
        button('▶ Play a round', { onClick: () => navigate('/play') }),
      ),
    ),
    tabbar('/leaderboard'),
  );

  fetchStandings()
    .then((rivals) => {
      const profile = Store.profile();
      const best = Store.progress().bestScore;

      const rows = rivals.map((r) => ({ ...r, you: false }));
      if (profile)
        rows.push({
          id: profile.id,
          name: profile.name,
          score: best,
          you: true,
          avatar: profile.avatar,
        });

      rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
      const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 })); // strictly sequential, no duplicates

      listHost.innerHTML = '';
      if (!ranked.length) {
        listHost.append(
          emptyState('📊', 'No standings yet', 'Play a round to put yourself on the board.'),
        );
        return;
      }

      const me = ranked.find((r) => r.you);
      listHost.append(
        el(
          'div',
          { class: 'lb-head' },
          el('span', { class: 't-kicker', text: 'This season' }),
          me && el('span', { class: 't-kicker', text: `You: #${me.rank}` }),
        ),
        el(
          'ol',
          { class: 'lb-list' },
          ...ranked.map((r) =>
            el(
              'li',
              {
                class: `lb-row${r.you ? ' lb-row--you' : ''}`,
                'aria-current': r.you ? 'true' : null,
              },
              el('span', {
                class: 'lb-row__rank',
                text: r.rank <= 3 ? MEDALS[r.rank - 1] : String(r.rank),
              }),
              r.avatar
                ? el('img', { class: 'lb-row__avatar', src: r.avatar, alt: '', loading: 'lazy' })
                : el('span', {
                    class: 'lb-row__avatar',
                    'aria-hidden': 'true',
                    style: {
                      display: 'grid',
                      placeItems: 'center',
                      background: '#eee',
                      fontSize: '13px',
                    },
                    text: '🍔',
                  }),
              el(
                'span',
                { class: 'lb-row__name' },
                el('span', { text: r.name }),
                r.you && el('i', { class: 'tag-you', text: 'YOU' }),
              ),
              el('span', { class: 'lb-row__score', text: fmt(r.score) }),
            ),
          ),
        ),
        me && me.score === 0
          ? el('p', { class: 'lb-note', text: 'Play a round to set your first score.' })
          : null,
      );
    })
    .catch(() => {
      listHost.innerHTML = '';
      listHost.append(
        emptyState(
          '⚠️',
          'Standings unavailable',
          'Could not load the board. Try again shortly.',
          el(
            'div',
            { style: { marginTop: '14px', width: '200px' } },
            button('Retry', { size: 'sm', onClick: () => navigate('/leaderboard') }),
          ),
        ),
      );
    });

  return () => clearInterval(tick);
}
