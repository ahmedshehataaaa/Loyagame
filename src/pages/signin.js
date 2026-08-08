/* Sign In — Stitch "McSlice Rush - Ronald Sign In".
   A country-code + phone field, inline validation, a guarded submit, and a
   guest path.

   ⚠️ THE NUMBER IS NOT VERIFIED. There is no OTP: `api/register.mjs` trusts the
   number as typed by an explicit product decision (July 2026), and re-claiming
   a number that already holds points appends a fraud flag for review at payout
   rather than blocking. The button therefore says "Continue", not "Send Code" —
   it used to say the latter while sending nothing, which promised a
   verification step that does not exist. See ADR 0009 for what real
   verification would require. */
import { el, button, toast } from '../components/ui.js';
import { Store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { register, clearIdentity } from '../services/loyalty.js';
import { t } from '../core/i18n.js';
import { track, EVENTS } from '../analytics/index.js';

const CODES = ['+20', '+1', '+44', '+62', '+971', '+966'];

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
  track(EVENTS.VERIFICATION_STARTED, { method: 'phone_unverified' });

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
  // "Continue", not "Send Code" — nothing is sent and nothing is verified.
  const submit = button(t('signin.continue'), { type: 'submit' });

  function setError(msg) {
    err.textContent = msg || '';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  input.addEventListener('input', () => {
    if (err.textContent) setError(null);
  });

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

    el('p', { class: 'signin__legal' }, t('signin.legal')),

    el('p', { class: 'signin__legal', text: t('signin.unverified') }),

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

    submitting = true;
    submit.disabled = true;
    submit.textContent = t('signin.signingIn');

    /* A real call now. This used to be a `setTimeout` pretending to be a
       round-trip, which meant the number never reached the backend and no
       round could ever be attributed to a player — so nothing was rewardable.
       Registering here is what makes /start-run able to grant a prize round. */
    register({ cc: ccSel.value, phone: digits, consent: true })
      .then((res) => {
        Store.signIn({
          name: `Player ${digits.slice(-4)}`,
          isGuest: false,
          avatar: 'assets/avatar.png',
        });

        track(EVENTS.VERIFICATION_COMPLETED, {
          method: 'phone_unverified',
          accepted: !!res.ok,
        });
        if (res.ok) {
          // The server's balance is authoritative from the moment we have it.
          const pts = res.data?.profile?.orderPoints;
          if (Number.isFinite(pts)) Store.setOrderPoints(pts);
          toast(t('signin.ok'), 'ok');
        } else if (res.kind === 'not_configured') {
          // Expected in a build with the backend switched off.
          toast(t('signin.practice'), 'ok');
        } else {
          // Local play still works; the round just will not be rewardable, and
          // play.js says so on the stake label rather than failing silently.
          toast(t('signin.noRewards'), 'bad');
        }
        navigate('/play');
      })
      .catch((error) => {
        console.error('register failed', error);
        Store.signIn({
          name: `Player ${digits.slice(-4)}`,
          isGuest: false,
          avatar: 'assets/avatar.png',
        });
        toast(t('signin.noRewards'), 'bad');
        navigate('/play');
      })
      .finally(() => {
        submitting = false;
        submit.disabled = false;
        submit.textContent = t('signin.continue');
      });
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
