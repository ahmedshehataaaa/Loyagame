/* Sign In — phone number is trusted as entered (July 2026 design decision).
   OTP verification is planned for a future release once an SMS provider is
   wired up; until then, register() creates/updates the player row and the
   user goes straight to the game. */
import { el, button, toast } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { register, clearIdentity, setIdentity } from '../services/loyalty.js';
import { t } from '../core/i18n.js';
import { track, EVENTS } from '../analytics/index.js';

const CODES = ['+62', '+20', '+1', '+44', '+971', '+966'];

/** Digits only, 6–13 long — matches the engine's old phone rule. */
function validate(cc, digits) {
  if (!digits) return t('signin.errEmpty');
  if (!/^\d+$/.test(digits)) return t('signin.errDigits');
  if (digits.length < 6) return t('signin.errShort');
  if (digits.length > 13) return t('signin.errLong');
  if (!cc) return t('signin.errCode');
  return null;
}

export function SignInPage(root) {
  let submitting = false;
  // `method` records the PATH taken, never the number itself.

  const ccSel = el(
    'select',
    { class: 'field__input field__cc', id: 'cc', 'aria-label': 'Country code' },
    ...CODES.map((c) => el('option', { value: c, text: c })),
  );

  const input = el('input', {
    class: 'field__input',
    id: 'phone',
    type: 'tel',
    inputmode: 'numeric',
    autocomplete: 'tel-national',
    placeholder: '812 3456 7890',
    'aria-describedby': 'phone-err',
  });

  const err = el('small', { class: 'field__error', id: 'phone-err', role: 'alert' });
  // Truthful again: pressing this really does send a code.
  const submit = button(t('signin.sendCode'), {
    type: 'submit',
    'data-act': 'send-code',
    disabled: true,
  });

  function setError(msg) {
    err.textContent = msg || '';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  /* The CTA reflects whether it can actually do anything. It starts inert and
     only lights up once the number would pass `validate()` — the same check the
     submit handler runs, so the button can never promise a send the handler
     then refuses. Silent while typing: no error is shown for a number that is
     merely unfinished, the button simply has not lit yet. */
  function syncSubmitState() {
    if (submitting) return;
    const digits = input.value.replace(/\D/g, '');
    const ready = validate(ccSel.value, digits) === null;
    submit.disabled = !ready;
    submit.classList.toggle('btn--glow', ready);
  }

  input.addEventListener('input', () => {
    if (err.textContent) setError(null);
    syncSubmitState();
  });
  ccSel.addEventListener('change', syncSubmitState);

  const form = el(
    'form',
    { class: 'signin__card card', novalidate: true },
    el('h1', { class: 'signin__title', text: t('signin.title') }),
    el('p', { class: 'signin__sub', text: t('signin.sub') }),

    el(
      'div',
      { class: 'field' },
      el('label', { class: 'field__label', for: 'phone', text: t('signin.label') }),
      el('div', { class: 'field__row' }, ccSel, input),
      err,
    ),

    submit,

    el(
      'p',
      { class: 'signin__legal' },
      ...t('signin.legal')
        .split(/(\{terms\}|\{privacy\})/)
        .map((chunk) => {
          if (chunk === '{terms}')
            return el('a', { class: 'text-link', href: '#/terms', text: t('signin.legalTerms') });
          if (chunk === '{privacy}')
            return el('a', { class: 'text-link', href: '#/terms', text: t('signin.legalPrivacy') });
          return document.createTextNode(chunk);
        }),
    ),

    el(
      'div',
      { class: 'signin__alt' },
      button(t('signin.guest'), {
        variant: 'ghost',
        size: 'sm',
        onClick: () => {
          // A guest has no number for the server to attribute a prize to, so
          // clear any stored identity: guest rounds must be practice rounds,
          // not rounds silently credited to a previous player on this device.
          clearIdentity();
          track(EVENTS.VERIFICATION_COMPLETED, { method: 'guest', accepted: true });
          Store.signIn({ name: 'Guest Slicer', isGuest: true, avatar: 'assets/avatar.png' });
          toast(t('signin.guestNote'), 'ok');
          navigate('/play');
        },
      }),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submitting) return; // guard double submit

    const digits = input.value.replace(/\D/g, '');
    const problem = validate(ccSel.value, digits);
    if (problem) {
      setError(problem);
      input.focus();
      return;
    }

    // Sign in immediately with the entered number — no OTP step.
    setIdentity(ccSel.value, digits);
    Store.signIn({ name: `Player ${digits.slice(-4)}`, isGuest: false, avatar: 'assets/avatar.png' });
    track(EVENTS.VERIFICATION_COMPLETED, { method: 'phone_direct', accepted: true });
    navigate('/play');

    // Fire-and-forget: create the player record server-side if possible.
    // Never block navigation or show an error if this fails.
    register({ cc: ccSel.value, phone: digits, consent: true })
      .then((reg) => {
        const pts = reg?.data?.profile?.orderPoints;
        if (Number.isFinite(pts)) Store.setOrderPoints(pts);
      })
      .catch(() => {});
  });

  root.append(
    el(
      'div',
      { class: 'screen bg-burst signin' },
      el(
        'header',
        { class: 'signin__brand' },
        el('img', { src: 'assets/brand-logo.png', alt: "McDonald's", width: '86', height: '86' }),
        el('p', { class: 'welcome__slogan', text: "i'm lovin' it" }),
      ),
      form,
      button(`← ${t('common.back')}`, {
        variant: 'ghost',
        size: 'sm',
        onClick: () => navigate('/'),
      }),
    ),
  );
}
