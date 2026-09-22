import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/* The engine used to start Web Audio only from the canvas's pointerdown. For a
 * TOUCH pointer that is not a user activation (the HTML spec counts pointerup,
 * touchend and click for touch), so on phones the AudioContext never left
 * "suspended" and every round was silent. engine/audio.js now unlocks on the
 * activating events themselves.
 *
 * Run in a vm with a fake window/document: audio.js is a classic script, and
 * the only thing under test is which events start the context. */
const source = readFileSync(new URL('../../engine/audio.js', import.meta.url), 'utf8');

function load() {
  const listeners = {};
  const contexts = [];
  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.sampleRate = 44100;
      this.destination = {};
      this.resumed = 0;
      contexts.push(this);
    }
    resume() {
      this.resumed++;
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    createBuffer() {
      return {};
    }
    createBufferSource() {
      return { connect() {}, start() {} };
    }
  }
  const document = {
    hidden: false,
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
  };
  const window = { AudioContext: FakeAudioContext };
  const sandbox = {
    window,
    document,
    navigator: {},
    Audio: class {
      setAttribute() {}
      play() {
        return Promise.resolve();
      }
    },
    setTimeout,
  };
  vm.runInNewContext(source, sandbox);
  const fire = (type) => (listeners[type] ?? []).forEach((fn) => fn({ type }));
  return { fire, contexts, listeners, Sound: window.Sound };
}

describe('audio unlock', () => {
  it.each(['touchend', 'pointerup', 'click'])('a %s starts the audio context', (type) => {
    const { fire, contexts } = load();
    expect(contexts).toHaveLength(0);
    fire(type);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].state).toBe('running');
  });

  it('does not wait for a swipe on the canvas', () => {
    const { listeners } = load();
    // Listening on the document, so the sign-in tap already unlocks.
    expect(Object.keys(listeners)).toEqual(expect.arrayContaining(['touchend', 'click']));
  });

  it('resumes a context iOS suspended while the page was hidden', () => {
    const { fire, contexts } = load();
    fire('click');
    contexts[0].state = 'interrupted';
    fire('visibilitychange');
    expect(contexts[0].state).toBe('running');
  });
});
