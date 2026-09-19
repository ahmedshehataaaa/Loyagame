import { describe, it, expect } from 'vitest';
import { resolveRewardOutcome, REWARD_STATUS } from '../../src/services/reward-state.js';
import { OUTCOME } from '../../src/game/round-rules.js';
import { t, setLang } from '../../src/core/i18n.js';

const survived = OUTCOME.SURVIVED;
const eliminated = OUTCOME.ELIMINATED;

/** A successful submit-run body that awards a prize. */
const awardBody = {
  won: true,
  prize: { key: 'bigmac', label: 'Free Big Mac®' },
  orderPoints: 1200,
  pointsThreshold: 4000,
};

describe('the core invariant: a prize requires an explicit server award', () => {
  /* Every transport failure kind the API layer can produce, plus one the
     taxonomy does not know about — an unrecognised kind must still deny.
     Typed loosely on purpose so that unknown value is expressible at all. */
  /** @type {any[]} */
  const failureKinds = [
    'offline',
    'timeout',
    'network',
    'bad_response',
    'server_error',
    'invalid_token',
    'rate_limited',
    'not_configured',
    'something_unrecognised',
  ];

  /* Every success body that is NOT an explicit, well-formed award. */
  const nonAwardBodies = [
    {},
    { won: false },
    { won: false, gap: 2800, orderPoints: 1200, pointsThreshold: 4000 },
    { won: null },
    { won: 'true' }, // string, not boolean — must not count
    { won: 1 }, // truthy, not true — must not count
    { won: true }, // award with no prize at all
    { won: true, prize: null },
    { won: true, prize: {} },
    { won: true, prize: { key: 'bigmac' } }, // no label
    { won: true, prize: { label: 'Free Big Mac®' } }, // no key
    { won: true, prize: { key: '', label: '' } },
    { won: true, prize: { key: 'x', label: 42 } }, // wrong type
    { won: true, prize: 'Free Big Mac®' }, // string, not object
    { won: true, prize: awardBody.prize, suspicious: true }, // flagged run
  ];

  it('never awards on any transport failure', () => {
    for (const kind of failureKinds) {
      const out = resolveRewardOutcome({
        roundOutcome: survived,
        apiResult: { ok: false, kind },
      });
      expect(out.awarded, `kind=${kind}`).toBe(false);
      expect(out.prize, `kind=${kind}`).toBeNull();
      expect(out.status, `kind=${kind}`).not.toBe(REWARD_STATUS.AWARDED);
    }
  });

  it('never awards on any non-award success body', () => {
    for (const data of nonAwardBodies) {
      const out = resolveRewardOutcome({
        roundOutcome: survived,
        apiResult: { ok: true, data },
      });
      expect(out.awarded, JSON.stringify(data)).toBe(false);
      expect(out.prize, JSON.stringify(data)).toBeNull();
    }
  });

  it('never awards when the round was not survived, even if the server says won', () => {
    // A server award for a lost round would itself be a bug; refusing to
    // display it is the safer of the two failure modes.
    const out = resolveRewardOutcome({
      roundOutcome: eliminated,
      apiResult: { ok: true, data: awardBody },
    });
    expect(out.awarded).toBe(false);
    expect(out.prize).toBeNull();
    expect(out.status).toBe(REWARD_STATUS.ELIMINATED);
  });

  it('never awards when no submission was attempted', () => {
    const out = resolveRewardOutcome({ roundOutcome: survived, apiResult: null });
    expect(out.awarded).toBe(false);
    expect(out.prize).toBeNull();
    expect(out.status).toBe(REWARD_STATUS.PENDING);
  });

  it('awards exactly when the server explicitly says so', () => {
    const out = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: { ok: true, data: awardBody },
    });
    expect(out.status).toBe(REWARD_STATUS.AWARDED);
    expect(out.awarded).toBe(true);
    expect(out.prize).toEqual({ key: 'bigmac', label: 'Free Big Mac®' });
  });

  it('passes through only the server-named prize, never a substitute', () => {
    const out = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: { ok: true, data: { won: true, prize: { key: 'fries', label: 'Free Fries' } } },
    });
    expect(out.prize.label).toBe('Free Fries');
  });
});

describe('failure states map to distinct, actionable statuses', () => {
  /** @type {[any, string][]} */
  const cases = [
    ['not_configured', REWARD_STATUS.UNAVAILABLE],
    ['invalid_token', REWARD_STATUS.SESSION_EXPIRED],
    ['rate_limited', REWARD_STATUS.RATE_LIMITED],
    ['offline', REWARD_STATUS.PENDING],
    ['timeout', REWARD_STATUS.PENDING],
    ['network', REWARD_STATUS.PENDING],
    ['bad_response', REWARD_STATUS.ERROR],
    ['server_error', REWARD_STATUS.ERROR],
  ];

  it.each(cases)('%s -> %s', (kind, expected) => {
    const out = resolveRewardOutcome({ roundOutcome: survived, apiResult: { ok: false, kind } });
    expect(out.status).toBe(expected);
  });

  it('every status has player-facing copy in every locale', () => {
    /* Copy moved out of this module into i18n (keyed by status) so the resolver
       stays pure and locale-free. The guarantee still has to hold, so it is
       asserted where it now lives: every status a resolver can return must have
       a title and a message in EN and AR. A status with no copy would render
       its own key on screen. */
    for (const status of Object.values(REWARD_STATUS)) {
      for (const locale of ['en', 'ar']) {
        setLang(/** @type {any} */ (locale));
        const title = t(`reward.${status}.title`);
        const msg = t(`reward.${status}.msg`);
        expect(title, `${locale}/${status} title`).not.toBe(`reward.${status}.title`);
        expect(title.length).toBeGreaterThan(0);
        // `awarded` shows the prize label instead of a generic message, so it
        // is the one status that legitimately has no `.msg`.
        if (status !== REWARD_STATUS.AWARDED) {
          expect(msg, `${locale}/${status} msg`).not.toBe(`reward.${status}.msg`);
          expect(msg.length).toBeGreaterThan(0);
        }
      }
    }
    setLang('en');
  });

  it('a flagged run is not paid out and says it is under review', () => {
    const out = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: { ok: true, data: { ...awardBody, suspicious: true } },
    });
    expect(out.status).toBe(REWARD_STATUS.FLAGGED);
    expect(out.awarded).toBe(false);
  });

  it('only genuinely re-checkable states are retryable', () => {
    const retryable = (kind) =>
      resolveRewardOutcome({ roundOutcome: survived, apiResult: { ok: false, kind } }).retryable;
    expect(retryable('network')).toBe(true);
    expect(retryable('timeout')).toBe(true);
    // A settled denial must not offer a retry that re-asks a closed question.
    expect(retryable('invalid_token')).toBe(false);
    expect(retryable('not_configured')).toBe(false);
    const denial = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: { ok: true, data: { won: false } },
    });
    expect(denial.retryable).toBe(false);
  });
});

describe('points reporting', () => {
  it('surfaces the server balance and threshold on a denial', () => {
    const out = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: { ok: true, data: { won: false, orderPoints: 1200, pointsThreshold: 4000 } },
    });
    expect(out.status).toBe(REWARD_STATUS.NOT_ELIGIBLE);
    expect(out.orderPoints).toBe(1200);
    expect(out.pointsThreshold).toBe(4000);
  });

  it('never invents a points figure', () => {
    const out = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: { ok: true, data: { won: false } },
    });
    expect(out.orderPoints).toBeNull();
    expect(out.pointsThreshold).toBeNull();
  });

  it('rejects non-numeric points rather than rendering NaN', () => {
    const out = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: { ok: true, data: { won: false, orderPoints: 'lots', pointsThreshold: null } },
    });
    expect(out.orderPoints).toBeNull();
    expect(out.pointsThreshold).toBeNull();
  });
});

describe('score-gated tenants (migration 0007)', () => {
  /** @returns {any} */
  const ok = (data) => ({ ok: true, data });

  it('carries the gate and the round score on a denial', () => {
    const r = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: ok({
        won: false,
        gap: 900,
        orderPoints: 0,
        pointsThreshold: 4000,
        gate: 'score',
        score: 3100,
      }),
    });
    expect(r.status).toBe(REWARD_STATUS.NOT_ELIGIBLE);
    expect(r.gate).toBe('score');
    expect(r.score).toBe(3100);
  });

  it('treats a missing or unknown gate as order points', () => {
    for (const gate of [undefined, 'vibes', 42]) {
      const r = resolveRewardOutcome({
        roundOutcome: survived,
        apiResult: ok({ won: false, orderPoints: 10, pointsThreshold: 4000, gate }),
      });
      expect(r.gate).toBe('order_points');
    }
  });

  it('still requires an explicit server award: a high score alone is not a prize', () => {
    const r = resolveRewardOutcome({
      roundOutcome: survived,
      apiResult: ok({ won: false, pointsThreshold: 4000, gate: 'score', score: 99999 }),
    });
    expect(r.awarded).toBe(false);
    expect(r.prize).toBe(null);
  });

  it('has score copy in both languages', () => {
    for (const lang of /** @type {const} */ (['en', 'ar'])) {
      setLang(lang);
      const msg = t('reward.not_eligible.msgScore', { threshold: '4000' });
      expect(msg).not.toBe('reward.not_eligible.msgScore');
    }
    setLang('en');
  });
});
