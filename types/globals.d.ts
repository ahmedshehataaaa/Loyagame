/* Ambient declarations for the engine globals.
 *
 * engine/*.js are classic scripts that publish onto `window` (see the tail of
 * engine/config.js and src/game/index.js). Without these declarations every
 * `window.CONFIG` / `window.Game` read is a type error under checkJs, which
 * would make the typecheck gate useless noise rather than a real signal.
 *
 * These are intentionally loose: the goal is to catch typos and wrong shapes at
 * the boundary, not to fully type a codebase that is deliberately untyped.
 * Tighten a member when its consumer needs the guarantee. */

interface SliceRushConfig {
  WIDTH: number;
  HEIGHT: number;
  GRAVITY: number;
  ROUND_TIME: number;
  START_LIVES: number;
  /** The win bar: score needed to win the round and open Spin to Win. */
  SPIN_WHEEL_MIN_SCORE: number;
  COMBO_WINDOW: number;
  HIT_TOLERANCE: number;
  RAMP_FRACTION: number;
  LAUNCH: {
    apexMin: number;
    apexMax: number;
    maxLateralFrac: number;
    marginFrac: number;
  };
  API: { enabled: boolean; base: string };
  WHEEL: {
    enabled: boolean;
    pointsThreshold: number;
    /** Round score needed to reach the wheel; 0 lets every survivor spin. */
    minRoundScore?: number;
    prizes: Array<{ key: string; glyph: string; label: string; weight: number }>;
  };
  LIMITS: { maxPlays: number; windowHrs: number; winLockoutHrs: number };
  spawn: Record<string, unknown>;
  POWERUP: Record<string, number>;
}

interface SliceRushGame {
  init(): void;
  startGame(): void;
  idle(): void;
  pauseGame(): void;
  resumeGame(): void;
  endGame(): void;
  goHome(): void;
  finishLoading(): void;
  getScene(): string;
  SCENE: Record<string, string>;
}

interface Window {
  CONFIG: SliceRushConfig;
  BRAND: Record<string, any>;
  FOODS: Array<Record<string, any>>;
  BOMB: Record<string, any>;
  SPECIALS: Record<string, any>;
  Game: SliceRushGame;
  Platform: {
    allowed(): boolean;
    realDevice(): boolean;
    viewport(): { x: number; y: number; w: number; h: number };
  };
  Sound: Record<string, any>;
  /** Published by src/game/index.js — the tested pure mechanics. */
  Mechanics: Record<string, any>;
  /** Satisfied by src/adapters/engine-bridge.js for the engine's benefit. */
  UI: Record<string, any>;
  LoyaltyData: Record<string, any>;
}
