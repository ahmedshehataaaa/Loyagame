/* ============================================================
   Audio — all sound effects are synthesized with the Web Audio
   API so the game ships with zero audio files. A single master
   gain lets us mute instantly.
   ============================================================ */

const Sound = (() => {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }

  // Browsers require audio to start from a user gesture.
  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur, type = 'sine', vol = 0.4, slideTo = null) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  function noise(dur, vol = 0.5, filterFreq = 1200) {
    if (!ctx || muted) return;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
  }

  return {
    unlock,
    isMuted: () => muted,
    toggleMute() {
      muted = !muted;
      return muted;
    },

    // A short upward "whoosh + squelch" when fruit is sliced.
    slice(combo = 1) {
      noise(0.12, 0.35, 1800);
      tone(380 + combo * 60, 0.12, 'triangle', 0.25, 720 + combo * 80);
    },
    // Rising chime for combo milestones.
    combo(n) {
      const base = 520 + n * 40;
      tone(base, 0.16, 'square', 0.22, base * 1.5);
    },
    // Heavy boom for bombs.
    bomb() {
      noise(0.5, 0.8, 600);
      tone(120, 0.5, 'sawtooth', 0.5, 40);
    },
    // Soft tick for menu buttons.
    click() {
      tone(660, 0.07, 'square', 0.18);
    },
    // Reward unlocked fanfare.
    reward() {
      [523, 659, 784, 1046].forEach((f, i) =>
        setTimeout(() => tone(f, 0.25, 'triangle', 0.3), i * 110),
      );
    },
    // Game-over descending tone.
    gameover() {
      tone(440, 0.6, 'sawtooth', 0.35, 110);
    },
  };
})();

// Expose for ES module consumers (top-level const does not attach to window).
window.Sound = Sound;
