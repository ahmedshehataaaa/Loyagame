/* ============================================================
   Mechanics namespace bridge.

   engine/*.js are classic scripts (no import statements) that execute
   before any module does, so they cannot import these ES modules
   directly. They call them at RUN time instead — via window.Mechanics,
   published here.

   That ordering is safe: the engine only reads Mechanics inside
   startGame()/update(), and nothing calls those until src/pages/play.js
   mounts, which is module code and therefore runs after this file.

   This is a deliberate stepping stone, not the end state — it lets the
   gameplay maths live in tested modules today without converting the
   whole engine to ESM in one risky change. See ADR 0005.
   ============================================================ */
import { systemRng, seededRng, lerp, range, intRange, pick } from './rng.js';
import { solveLaunch, launchSpeedForApex, hangTime, horizontalVelocity } from './ballistics.js';
import { segmentHitsCircle, distanceToSegment, corridorGap } from './collision.js';
import { planWave, difficultyAt } from './wave-planner.js';
import { resolveOutcome, applyHazardHit, isWin, isPlausibleRun, OUTCOME } from './round-rules.js';
import { capPush, burstSize, shakeAmount, shouldTick, FX_DEFAULTS } from './fx-budget.js';

export const Mechanics = {
  systemRng,
  seededRng,
  lerp,
  range,
  intRange,
  pick,
  solveLaunch,
  launchSpeedForApex,
  hangTime,
  horizontalVelocity,
  segmentHitsCircle,
  distanceToSegment,
  corridorGap,
  planWave,
  difficultyAt,
  resolveOutcome,
  applyHazardHit,
  isWin,
  isPlausibleRun,
  OUTCOME,
  capPush,
  burstSize,
  shakeAmount,
  shouldTick,
  FX_DEFAULTS,
};

window.Mechanics = Mechanics;
