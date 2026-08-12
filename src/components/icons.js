/* ============================================================
   Icon set — real SVG, replacing the emoji the UI used to render.

   Emoji were never a design decision, they were a placeholder: the glyph
   is chosen by the PLATFORM, so the medals, tab bar and empty states all
   rendered differently on iOS, Android, Windows and macOS, at sizes and
   weights nothing in tokens.css could control, and with no way to match
   the Stitch reference's Material Symbols.

   These trace the symbols used in stitch-export/screens/leaderboard —
   emoji_events (trophy), military_tech (medal), verified, schedule.
   Every path is authored on a 24x24 grid and filled with `currentColor`,
   so size comes from the `size` argument and colour from ordinary CSS
   `color` on the icon or any ancestor.
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Static, developer-authored markup — no interpolation of runtime values,
   so assigning it as innerHTML introduces no injection surface. Interactive
   nodes are still built with el() so listeners stay attached to the node. */
const SHAPES = {
  trophy: `
    <path d="M6 3h12v5a6 6 0 0 1-12 0V3Z"/>
    <path d="M11 13h2v5h-2Z"/>
    <path d="M7 19h10v2H7Z"/>
    <path d="M6 5H3v2a4 4 0 0 0 4 4V9a2 2 0 0 1-2-2V5Z"/>
    <path d="M18 5h3v2a4 4 0 0 1-4 4V9a2 2 0 0 0 2-2V5Z"/>`,
  medal: `
    <path d="M8 2 4.2 7.6 7 9.4 10.4 4.2 8 2Z"/>
    <path d="M16 2l3.8 5.6L17 9.4 13.6 4.2 16 2Z"/>
    <circle cx="12" cy="15.5" r="6.2"/>`,
  verified: `
    <path d="M12 1.6 14.3 4l3.3-.4.9 3.2 3 1.5-1.6 2.9 1.6 2.9-3 1.5-.9 3.2-3.3-.4L12 20.4 9.7 18l-3.3.4-.9-3.2-3-1.5L4.1 11 2.5 8.3l3-1.5.9-3.2 3.3.4L12 1.6Z"/>
    <path d="M10.9 14.7 7.9 11.7l1.5-1.4 1.5 1.5 3.7-3.7 1.5 1.4-5.2 5.2Z" fill="#fff"/>`,
  clock: `
    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z"/>
    <path d="M11 7h2v5.4l3.4 2-1 1.7L11 13.6V7Z"/>`,
  home: `
    <path d="M12 3 1.5 12H5v9h5v-6h4v6h5v-9h3.5L12 3Z"/>`,
  gift: `
    <path d="M2 8h20v4H2V8Z"/>
    <path d="M4 13h7v9H5a1 1 0 0 1-1-1v-8Z"/>
    <path d="M13 13h7v8a1 1 0 0 1-1 1h-6v-9Z"/>
    <path d="M8.6 2.2a3 3 0 0 1 3.4 1.1l.9 1.3-2.4.3a3 3 0 0 1-3.2-1.6 1.6 1.6 0 0 1 1.3-1.1Z"/>
    <path d="M15.4 2.2a3 3 0 0 0-3.4 1.1l-.9 1.3 2.4.3a3 3 0 0 0 3.2-1.6 1.6 1.6 0 0 0-1.3-1.1Z"/>`,
  gamepad: `
    <path d="M7 7h10a5 5 0 0 1 5 5v2a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-2a5 5 0 0 1 5-5Z"/>
    <path d="M6 10h2v1.5h1.5v2H8V15H6v-1.5H4.5v-2H6V10Z" fill="#fff"/>
    <circle cx="16.5" cy="11.5" r="1.3" fill="#fff"/>
    <circle cx="19" cy="14" r="1.3" fill="#fff"/>`,
  chart: `
    <path d="M3 20h18v2H3Z"/>
    <path d="M5 12h3v6H5Z"/>
    <path d="M10.5 7h3v11h-3Z"/>
    <path d="M16 10h3v8h-3Z"/>`,
  alert: `
    <path d="M12 2 1 21h22L12 2Z"/>
    <path d="M11 9h2v6h-2Zm0 8h2v2h-2Z" fill="#fff"/>`,
  user: `
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>
    <path d="M12 13.6c-4.2 0-7.6 2.1-7.6 4.8V21h15.2v-2.6c0-2.7-3.4-4.8-7.6-4.8Z"/>`,
  play: `
    <path d="M7 4.5 20 12 7 19.5V4.5Z"/>`,
  lock: `
    <path d="M12 1.8A4.7 4.7 0 0 0 7.3 6.5V9H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1h-1.3V6.5A4.7 4.7 0 0 0 12 1.8Zm2.7 7.2H9.3V6.5a2.7 2.7 0 0 1 5.4 0V9Z"/>
    <circle cx="12" cy="15" r="1.8" fill="#fff"/>`,
  ticket: `
    <path d="M3 6h18v3.5a2.5 2.5 0 0 0 0 5V18H3v-3.5a2.5 2.5 0 0 0 0-5V6Z"/>
    <path d="M9 8.5h1.5v7H9zM13.5 8.5H15v7h-1.5z" fill="#fff"/>`,
  soundOn: `
    <path d="M4 9h3.5L12 4.8v14.4L7.5 15H4V9Z"/>
    <path d="M15.4 8.2a5 5 0 0 1 0 7.6l1.3 1.5a7 7 0 0 0 0-10.6l-1.3 1.5Z"/>`,
  soundOff: `
    <path d="M4 9h3.5L12 4.8v14.4L7.5 15H4V9Z"/>
    <path d="m20.9 9.5-1.4-1.4-2 2-2-2-1.4 1.4 2 2-2 2 1.4 1.4 2-2 2 2 1.4-1.4-2-2 2-2Z"/>`,
  blade: `
    <path d="M3 15.2 15.6 2.6a1 1 0 0 1 1.5.1l2.2 2.7a1 1 0 0 1-.1 1.4L6.8 18.2 3 15.2Z"/>
    <path d="M2.2 17.2 5.4 19.8l-2.6 1.5a.8.8 0 0 1-1.1-.9l.5-3.2Z"/>`,
  fries: `
    <path d="M6.5 9.5 8 3.2l1.9.5-1.4 6.1-2-.3Z"/>
    <path d="M11 9.2V2.4h2v6.8h-2Z"/>
    <path d="M15.5 9.8 16.9 3.7l1.9.5-1.4 6-1.9-.4Z"/>
    <path d="M4.4 10.6h15.2l-1.5 9.1a2 2 0 0 1-2 1.7H7.9a2 2 0 0 1-2-1.7l-1.5-9.1Z"/>`,
};

/** @typedef {keyof typeof SHAPES} IconName */

/**
 * Build an icon node.
 *
 * Decorative by default (`aria-hidden`), because these sit beside a real
 * text label almost everywhere. Pass a `title` only where the icon is the
 * sole carrier of meaning — the medal on a leaderboard row is decorative,
 * since the rank is also announced as a number.
 *
 * @param {IconName} name
 * @param {{ size?: number, className?: string, title?: string }} [opts]
 * @returns {SVGElement}
 */
export function icon(name, opts = {}) {
  const { size = 20, className = '', title = '' } = opts;
  const shape = SHAPES[name];
  if (!shape) throw new Error(`icon: unknown name "${name}"`);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);

  if (title) {
    svg.setAttribute('role', 'img');
    const label = document.createElementNS(SVG_NS, 'title');
    label.textContent = title;
    svg.append(label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }

  svg.insertAdjacentHTML('beforeend', shape);
  return svg;
}

/**
 * Swap the icon inside a host element.
 *
 * Toggles used to do `span.textContent = on ? '🔊' : '🔇'`, which with an SVG
 * child would delete the icon and leave a bare text node. Replace the children
 * instead.
 *
 * @param {Element|null} host
 * @param {IconName} name
 * @param {{ size?: number, className?: string, title?: string }} [opts]
 */
export function setIcon(host, name, opts) {
  if (host) host.replaceChildren(icon(name, opts));
}

/** The three podium icons, by rank. Rank 1 gets the cup, 2 and 3 a medal.
 *  @type {IconName[]} */
export const RANK_ICONS = ['trophy', 'medal', 'medal'];

/** Podium tints, mirroring the Stitch reference's gold/slate/bronze. */
export const RANK_TINTS = ['var(--c-secondary-dark)', '#8c9099', '#b4590f'];
