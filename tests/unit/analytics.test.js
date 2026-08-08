import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EVENTS,
  ALLOWED,
  FORBIDDEN,
  buildPayload,
  isKnownEvent,
  isForbiddenKey,
} from '../../src/analytics/events.js';
import {
  track,
  setSink,
  setContext,
  setEnabled,
  buffered,
  analyticsStats,
  resetAnalytics,
} from '../../src/analytics/index.js';

beforeEach(() => {
  resetAnalytics();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the taxonomy is closed', () => {
  it('covers every event the brief asks for', () => {
    const required = [
      'campaign_viewed',
      'verification_started',
      'verification_completed',
      'instructions_viewed',
      'game_started',
      'game_paused',
      'game_resumed',
      'game_won',
      'game_lost',
      'reward_eligible',
      'reward_issued',
      'reward_viewed',
      'reward_copied',
      'reward_redeemed',
      'replay_started',
      'leaderboard_viewed',
      'error_encountered',
      'suspicious_activity',
    ];
    for (const name of required) {
      expect(isKnownEvent(name), `missing event: ${name}`).toBe(true);
    }
  });

  it('every event declares an allow-list', () => {
    // An event with no allow-list would silently transmit nothing, which looks
    // like the event is broken rather than like a missing declaration.
    for (const name of Object.values(EVENTS)) {
      expect(ALLOWED[name], `no ALLOWED entry for ${name}`).toBeDefined();
      expect(Array.isArray(ALLOWED[name])).toBe(true);
    }
  });

  it('rejects an unknown event name rather than inventing one', () => {
    // Free-form names drift: game_start / gameStarted / start_game all appear
    // within weeks and every funnel built on them is wrong.
    expect(buildPayload('gameStarted', {}).ok).toBe(false);
    expect(track('gameStarted', {})).toBeNull();
    expect(analyticsStats().rejected).toBe(1);
  });

  it('no allow-list contains a forbidden key', () => {
    // Guards the failure mode where someone adds `phone` to a list by mistake.
    for (const [name, keys] of Object.entries(ALLOWED)) {
      for (const key of keys) {
        expect(isForbiddenKey(key), `${name} allows forbidden key ${key}`).toBe(false);
      }
    }
  });
});

describe('payloads are allow-listed, not deny-filtered', () => {
  it('drops any key the event did not declare', () => {
    const built = buildPayload(EVENTS.GAME_WON, { score: 100, somethingNew: 'x' });
    expect(built.props).toEqual({ score: 100 });
    expect(built.dropped).toContain('somethingNew');
  });

  it('never transmits a phone number, under any spelling', () => {
    for (const key of ['phone', 'phoneNumber', 'mobile_number', 'MSISDN', 'msisdn']) {
      const built = buildPayload(EVENTS.VERIFICATION_COMPLETED, { [key]: '+201001234567' });
      expect(Object.keys(built.props), `leaked ${key}`).not.toContain(key);
      expect(JSON.stringify(built.props)).not.toContain('201001234567');
    }
  });

  it('never transmits a prize CODE, even though prize KEYS are fine', () => {
    // Knowing `fries` was won is a business metric. Knowing the code that
    // claims it is a bearer token.
    const built = buildPayload(EVENTS.REWARD_ISSUED, {
      prizeKey: 'fries',
      code: 'MC-ABC-123',
      rewardCode: 'MC-ABC-123',
      coupon: 'MC-ABC-123',
    });
    expect(built.props).toEqual({ prizeKey: 'fries' });
    expect(JSON.stringify(built.props)).not.toContain('MC-ABC-123');
  });

  it('never transmits names, tokens or device identifiers', () => {
    const built = buildPayload(EVENTS.GAME_WON, {
      score: 10,
      playerName: 'Ahmed',
      name: 'Ahmed',
      deviceToken: 'uuid-here',
      deviceId: 'uuid-here',
      sessionToken: 'tok',
    });
    expect(built.props).toEqual({ score: 10 });
  });

  it('drops nested objects whole rather than walking them', () => {
    // Walking invites a deep-redaction bug, and nothing in the taxonomy needs
    // it — so a nested value is a signal the call site is wrong.
    const built = buildPayload(EVENTS.GAME_WON, {
      score: 1,
      // A forbidden key hidden one level down.
      extra: { phone: '+201001234567' },
    });
    expect(built.props).toEqual({ score: 1 });
    expect(JSON.stringify(built.props)).not.toContain('201001234567');
  });

  it('caps string length so a stray message cannot become a payload', () => {
    const built = buildPayload(EVENTS.ERROR_ENCOUNTERED, { kind: 'x'.repeat(500) });
    expect(String(built.props.kind).length).toBeLessThanOrEqual(120);
  });

  it('omits undefined rather than sending a null-ish field', () => {
    const built = buildPayload(EVENTS.REWARD_ISSUED, { prizeKey: 'fries', orderPoints: undefined });
    expect(Object.keys(built.props)).toEqual(['prizeKey']);
  });

  it('the FORBIDDEN list is non-trivial', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(10);
  });
});

describe('transport', () => {
  it('buffers until a sink exists, then delivers', () => {
    // No analytics vendor is chosen yet, so buffering is the normal state —
    // events must not be lost while that decision is outstanding.
    track(EVENTS.CAMPAIGN_VIEWED, {});
    track(EVENTS.GAME_STARTED, { rewardable: true });
    expect(buffered()).toHaveLength(2);

    const seen = [];
    setSink((e) => seen.push(e.name));
    expect(seen).toEqual(['campaign_viewed', 'game_started']);
    expect(buffered()).toHaveLength(0);
  });

  it('bounds the buffer so an unattended tab cannot grow it forever', () => {
    for (let i = 0; i < 500; i++) track(EVENTS.GAME_PAUSED, { reason: 'player' });
    expect(buffered().length).toBeLessThanOrEqual(100);
  });

  it('re-buffers rather than losing an event when the sink throws', () => {
    setSink(() => {
      throw new Error('vendor down');
    });
    track(EVENTS.GAME_WON, { score: 1 });
    expect(buffered()).toHaveLength(1);
  });

  it('never throws into the caller', () => {
    setSink(() => {
      throw new Error('boom');
    });
    // Gameplay must not be able to break because analytics did.
    expect(() => track(EVENTS.GAME_LOST, { score: 1 })).not.toThrow();
  });

  it('merges context into every event, redacted like anything else', () => {
    setContext({ campaignId: 'mcdonalds', locale: 'ar', phone: '+201001234567' });
    const e = track(EVENTS.CAMPAIGN_VIEWED, {});
    expect(e.props.campaignId).toBe('mcdonalds');
    expect(e.props.locale).toBe('ar');
    expect(JSON.stringify(e.props)).not.toContain('201001234567');
  });

  it('can be switched off entirely', () => {
    setEnabled(false);
    expect(track(EVENTS.GAME_WON, { score: 1 })).toBeNull();
    expect(buffered()).toHaveLength(0);
  });

  it('counts redactions so a bad call site is noticeable', () => {
    track(EVENTS.GAME_WON, { score: 1, phone: 'x', nope: 'y' });
    expect(analyticsStats().redactions).toBeGreaterThanOrEqual(2);
  });
});
