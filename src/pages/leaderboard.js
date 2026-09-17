/* Pro Leaderboard — Stitch "McSlice Rush - Pro Leaderboard".
   Season countdown, medal ranks, and the signed-in player merged in
   and highlighted. Rival rows are seeded prototype data (see
   data/catalog.js); the player's row is their real best score.

   Layout, card system and spacing follow
   stitch-export/screens/leaderboard/source.html: a bevelled season card over
   a stack of row CARDS (not a plain list), the podium three carrying an icon
   instead of a number, and the player's row lifted onto the gold surface with
   a rotated YOU tag. */
import { el, button, topbar, fmt, emptyState, loadingState } from '../components/ui.js';
import { icon, RANK_ICONS, RANK_TINTS } from '../components/icons.js';
import { normalizeRow, rankStandings, tierFor } from '../game/standings.js';
import { RIVALS } from '../data/catalog.js';
import { Store } from '../core/store.js';
import { track, EVENTS } from '../analytics/index.js';
import { navigate } from '../core/router.js';

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

/** Milliseconds left in the season. */
function seasonMsLeft() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  // getTime() rather than relying on Date arithmetic coercion — the implicit
  // Date-minus-Date works at runtime but is not type-safe and hides intent.
  return Math.max(0, end.getTime() - now.getTime());
}

function seasonRemaining() {
  let ms = seasonMsLeft();
  const d = Math.floor(ms / 86400000);
  ms -= d * 86400000;
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  return `${d}d ${h}h ${m}m`;
}

/* Urgency, in two steps rather than a gradient: a colour that drifts
   continuously reads as a rendering bug, one that changes at a threshold reads
   as a deadline. Under a day the clock warms; under an hour it goes red and
   pulses. */
function seasonUrgency(ms = seasonMsLeft()) {
  if (ms < 3600000) return 'is-critical';
  if (ms < 86400000) return 'is-soon';
  return '';
}

/* The sunburst that turns slowly behind the season card in the reference.
   Decorative, and it inherits the reduced-motion stop from tokens.css. */
function seasonRays() {
  const wrap = el('div', { class: 'season__rays', 'aria-hidden': 'true' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('fill', 'currentColor');
  svg.insertAdjacentHTML(
    'beforeend',
    `<path d="M50 50L0 0H20L50 50Z"/><path d="M50 50L40 0H60L50 50Z"/>
     <path d="M50 50L80 0H100L50 50Z"/><path d="M50 50L100 30V50L50 50Z"/>
     <path d="M50 50L100 70V90L50 50Z"/><path d="M50 50L80 100H60L50 50Z"/>
     <path d="M50 50L40 100H20L50 50Z"/><path d="M50 50L0 80V60L50 50Z"/>`,
  );
  wrap.append(svg);
  return wrap;
}

function standingsRow(row) {
  const podium = row.rank <= 3;
  return el(
    'li',
    {
      class: [
        'lb-row',
        podium ? 'lb-row--podium' : '',
        row.you ? 'lb-row--you' : '',
        row.rank > 3 && !row.you ? 'lb-row--field' : '',
      ]
        .filter(Boolean)
        .join(' '),
      'aria-current': row.you ? 'true' : null,
      // Gold/slate/bronze from the reference, handed to CSS as a custom
      // property so the medal tint is data-driven rather than :nth-child —
      // the player's row can land anywhere in the podium and must not shift it.
      style: podium ? { '--medal': RANK_TINTS[row.rank - 1] } : null,
    },
    row.you ? el('i', { class: 'lb-row__flag', text: 'YOU' }) : null,
    el(
      'span',
      { class: 'lb-row__rank' },
      podium
        ? icon(RANK_ICONS[row.rank - 1], {
            size: 30,
            className: 'lb-row__medal',
            // Rank is already in the accessible name via the visually hidden
            // number below, so the medal itself stays decorative.
          })
        : null,
      podium
        ? el('span', { class: 'sr-only', text: `Rank ${row.rank}` })
        : el('span', { text: String(row.rank) }),
    ),
    el(
      'span',
      { class: 'lb-row__meta' },
      el(
        'span',
        { class: 'lb-row__name' },
        el('span', { text: row.name }),
        row.rank === 1 ? icon('verified', { size: 14, className: 'lb-row__verified' }) : null,
        row.you ? el('i', { class: 'lb-row__live', text: 'LIVE' }) : null,
      ),
      el('span', { class: 'lb-row__tier', text: tierFor(row.rank) }),
    ),
    el(
      'span',
      { class: 'lb-row__score' },
      el('b', { text: fmt(row.score) }),
      el('i', { class: 'lb-row__unit', text: 'PTS' }),
    ),
  );
}

export function LeaderboardPage(root) {
  track(EVENTS.LEADERBOARD_VIEWED, {});
  const listHost = el('div', null, loadingState('Loading standings…'));
  const clockEl = el('b', { class: 'season__clock', text: seasonRemaining() });
  const timeWrap = el(
    'div',
    { class: `season__time ${seasonUrgency()}`.trim() },
    icon('clock', { size: 22 }),
    clockEl,
  );
  const tick = setInterval(() => {
    clockEl.textContent = seasonRemaining();
    // Re-derive rather than assume: a tab left open across the threshold must
    // reach the urgent state without a reload.
    timeWrap.className = `season__time ${seasonUrgency()}`.trim();
  }, 30000);

  root.append(
    el(
      'div',
      { class: 'screen bg-burst' },
      topbar('Standings', { back: '/' }),
      el(
        'section',
        { class: 'card season' },
        seasonRays(),
        el(
          'div',
          { class: 'season__body' },
          el('span', { class: 't-kicker', text: 'Season ends in' }),
          timeWrap,
          el('span', { class: 'season__reset', text: 'Month-end reset' }),
        ),
      ),
      listHost,
      el(
        'div',
        { style: { marginTop: 'auto', paddingTop: '18px' } },
        button('Play a round', {
          icon: icon('play', { size: 15 }),
          onClick: () => navigate('/play'),
        }),
      ),
    ),
  );

  fetchStandings()
    .then((rivals) => {
      const profile = Store.profile();
      const best = Store.progress().bestScore;

      const rows = Array.isArray(rivals) ? rivals.slice() : [];
      if (profile) rows.push(normalizeRow({ ...profile, score: best, you: true }));
      const ranked = rankStandings(rows);

      listHost.innerHTML = '';
      if (!ranked.length) {
        listHost.append(
          emptyState(
            icon('chart', { size: 40 }),
            'No standings yet',
            'Play a round to put yourself on the board.',
          ),
        );
        return;
      }

      const me = ranked.find((r) => r.you);

      /* THE "null" BUG. This used to be a single `listHost.append(a, b, cond ?
         node : null)`. `el()` filters null children, but `Node.append()` does
         NOT — it stringifies, so the falsy branch appended a literal "null"
         text node under the last row. The ternary was false in the common case
         AND in the guest case, so the board printed "null" essentially always.
         Build the list first, drop the empties, then append. */
      const children = [
        el(
          'div',
          { class: 'lb-head' },
          el('span', { class: 't-kicker', text: 'This season' }),
          // Only claim a position when there IS one. Rendering `You: #${me.rank}`
          // against a missing row would print "You: #undefined".
          me ? el('span', { class: 't-kicker', text: `You: #${me.rank}` }) : null,
        ),
        el('ol', { class: 'lb-list' }, ...ranked.map(standingsRow)),
        me && me.score === 0
          ? el('p', { class: 'lb-note', text: 'Play a round to set your first score.' })
          : null,
      ].filter((node) => node instanceof Node);

      listHost.append(...children);
    })
    .catch(() => {
      listHost.innerHTML = '';
      listHost.append(
        emptyState(
          icon('alert', { size: 40 }),
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
