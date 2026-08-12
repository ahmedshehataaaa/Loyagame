/* ============================================================
   Shared render helpers. Everything returns a real DOM node —
   no innerHTML string-slinging for interactive elements, so
   listeners and accessible names stay attached to the node.
   ============================================================ */
import { navigate } from '../core/router.js';
import { t } from '../core/i18n.js';
import { icon } from './icons.js';

/**
 * Apply a style object, including CSS custom properties.
 *
 * `Object.assign(node.style, obj)` silently DROPS any `--custom` key: a
 * CSSStyleDeclaration has no such property to assign to, so the write is a
 * no-op with no error. That cost real time on the spin wheel, where every
 * segment's `--seg-a` vanished and the cards settled at the wrong angle.
 */
function applyStyle(node, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (value == null) continue;
    if (prop.startsWith('--')) node.style.setProperty(prop, String(value));
    else node.style[prop] = value;
  }
}

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  // `props` is often passed as an explicit null when a node only has
  // children, so normalise rather than relying on a default parameter.
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') applyStyle(node, v);
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const fmt = (n) => Number(n || 0).toLocaleString();

/* ---- Buttons ---------------------------------------------- */
/**
 * @typedef {object} ButtonOptions
 * @property {'primary'|'ghost'|string} [variant]
 * @property {'sm'|string} [size]
 * @property {(e:Event)=>void} [onClick]
 * @property {string} [href]     renders an <a> instead of a <button>
 * @property {boolean} [disabled]
 * @property {string|Node} [icon] decorative glyph or icon node before the label
 * @property {string} [type]     button type, e.g. 'submit'
 */

/**
 * @param {string} label
 * @param {ButtonOptions & Record<string, any>} [opts]
 */
export function button(
  label,
  { variant = 'primary', size, onClick, href, disabled, icon, ...rest } = {},
) {
  const cls = ['btn', `btn--${variant}`, size === 'sm' && 'btn--sm'].filter(Boolean).join(' ');
  // An icon node goes in as-is; a string keeps the old wrapped-glyph shape so
  // callers can migrate to icons.js one screen at a time.
  const kids = [
    icon instanceof Node ? icon : icon && el('span', { 'aria-hidden': 'true', text: icon }),
    label,
  ];
  if (href) return el('a', { class: cls, href, ...rest }, ...kids);
  return el(
    'button',
    {
      class: cls,
      type: 'button',
      disabled,
      onClick: onClick || (() => {}),
      ...rest,
    },
    ...kids,
  );
}

/**
 * @param {string|Node} glyph
 * @param {string} label accessible name — icon buttons have no visible text
 * @param {{onClick?:(e:Event)=>void, href?:string, plain?:boolean} & Record<string, any>} [opts]
 */
export function iconButton(glyph, label, { onClick, href, plain, ...rest } = {}) {
  const cls = `icon-btn${plain ? ' icon-btn--plain' : ''}`;
  /* Always wrapped in the span, node or not: callers that swap the glyph later
     do it with `btn.querySelector('span')`, so the wrapper is load-bearing. */
  const kids = [
    el('span', { 'aria-hidden': 'true' }, glyph instanceof Node ? glyph : String(glyph)),
  ];
  if (href) return el('a', { class: cls, href, 'aria-label': label, ...rest }, ...kids);
  return el(
    'button',
    { class: cls, type: 'button', 'aria-label': label, onClick, ...rest },
    ...kids,
  );
}

/* ---- Screen header ----------------------------------------- */
/**
 * @param {string} title
 * @param {{back?:string, onBack?:(e:Event)=>void, right?:Node}} [opts]
 */
export function topbar(title, { back = '/', onBack, right } = {}) {
  return el(
    'header',
    { class: 'topbar' },
    onBack
      ? iconButton('←', 'Go back', { onClick: onBack })
      : iconButton('←', 'Go back', { href: `#${back}` }),
    el('h1', { class: 'topbar__title t-headline', text: title }),
    right || el('span', { class: 'topbar__spacer', 'aria-hidden': 'true' }),
  );
}

/* ---- Stats & meter ----------------------------------------- */
export function stat(value, label) {
  return el(
    'div',
    { class: 'stat' },
    el('b', { class: 'stat__value', text: fmt(value) }),
    el('small', { class: 'stat__label', text: label }),
  );
}

/**
 * @param {number} value
 * @param {number} max
 * @param {{label?:string, hint?:string}} [opts]
 */
export function meter(value, max, { label, hint } = {}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return el(
    'div',
    { class: 'meter' },
    (label || hint) &&
      el(
        'div',
        { class: 'meter__head' },
        label && el('span', { class: 't-kicker', text: label }),
        hint && el('span', { class: 't-kicker', text: hint }),
      ),
    el(
      'div',
      {
        class: 'meter__track',
        role: 'progressbar',
        'aria-valuenow': Math.round(value),
        'aria-valuemin': '0',
        'aria-valuemax': String(max),
        'aria-label': label || 'Progress',
      },
      el('div', { class: 'meter__fill', style: { width: `${pct}%` } }),
      pct > 2 &&
        pct < 100 &&
        el('i', { class: 'meter__spark', style: { left: `calc(${pct}% - 4px)` } }),
    ),
  );
}

/* ---- Bottom navigation -------------------------------------- */
/* Labels are resolved per render so a language switch repaints them.
   `/wallet` is in the player nav; `/assets` is dev-only and deliberately not. */
/** @type {{ path: string, icon: import('./icons.js').IconName, key: string }[]} */
const TABS = [
  { path: '/', icon: 'home', key: 'common.home' },
  { path: '/wallet', icon: 'gift', key: 'common.wallet' },
  { path: '/play', icon: 'gamepad', key: 'common.play' },
  { path: '/leaderboard', icon: 'trophy', key: 'common.ranks' },
];

export function tabbar(activePath) {
  return el(
    'nav',
    { class: 'tabbar', 'aria-label': 'Main' },
    ...TABS.map((tab) =>
      el(
        'button',
        {
          class: 'tabbar__item',
          type: 'button',
          'aria-current': tab.path === activePath ? 'page' : null,
          onClick: () => navigate(tab.path),
        },
        icon(tab.icon, { size: 22, className: 'tabbar__icon' }),
        t(tab.key),
      ),
    ),
  );
}

/* ---- Feedback ------------------------------------------------ */
let toastTimer = null;
export function toast(message, kind = '') {
  document.querySelector('.toast')?.remove();
  const node = el('div', {
    class: `toast ${kind ? `toast--${kind}` : ''}`,
    role: 'status',
    'aria-live': 'polite',
    text: message,
  });
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2600);
}

export function emptyState(glyph, title, body, action) {
  return el(
    'div',
    { class: 'state' },
    // `glyph` accepts an icon node or a plain string, so callers can migrate
    // off emoji one screen at a time without a flag-day change here.
    el(
      'span',
      { class: 'state__glyph', 'aria-hidden': 'true' },
      glyph instanceof Node ? glyph : String(glyph),
    ),
    el('p', { class: 'state__title', text: title }),
    body && el('p', { class: 'state__body', text: body }),
    action,
  );
}

export function loadingState(text = 'Loading…') {
  return el(
    'div',
    { class: 'state' },
    el('div', { class: 'spinner', role: 'status', 'aria-label': text }),
  );
}

/* ---- Modal --------------------------------------------------- */
export function modal({ title, body, actions = [], onClose }) {
  const panel = el(
    'div',
    { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('h2', { class: 'modal__title', text: title }),
    typeof body === 'string' ? el('p', { text: body }) : body,
    el('div', { class: 'modal__actions' }, ...actions),
  );
  const overlay = el('div', { class: 'modal' }, panel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && onClose) onClose();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape' && onClose) {
      document.removeEventListener('keydown', esc);
      onClose();
    }
  });
  return overlay;
}
