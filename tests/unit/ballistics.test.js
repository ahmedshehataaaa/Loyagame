import { describe, it, expect } from 'vitest';
import {
  launchSpeedForApex,
  hangTime,
  horizontalVelocity,
  solveLaunch,
} from '../../src/game/ballistics.js';

const GRAVITY = 1900;
const FIELD_H = 1280; // portrait, per CONFIG

/**
 * Simulate the flight to check the solution actually behaves as claimed.
 *
 * Uses velocity-Verlet (y += v·dt + ½·a·dt²), which is EXACT for constant
 * acceleration. Plain forward Euler — the obvious first choice here — is not:
 * it systematically under-shoots the apex by roughly half a step of velocity
 * change, about 0.45% at 240Hz, which is large enough to make a correct
 * closed-form solution look wrong.
 */
function simulate({ x, y, vx, vy }, gravity, seconds, step = 1 / 240) {
  let peakY = y;
  for (let t = 0; t < seconds; t += step) {
    y += vy * step + 0.5 * gravity * step * step;
    vy += gravity * step;
    x += vx * step;
    if (y < peakY) peakY = y;
  }
  return { x, y, peakY };
}

describe('launchSpeedForApex', () => {
  it('reaches the requested apex when simulated', () => {
    const apex = 800;
    const speed = launchSpeedForApex(GRAVITY, apex);
    const flight = hangTime(GRAVITY, speed);
    const { peakY } = simulate({ x: 0, y: 0, vx: 0, vy: -speed }, GRAVITY, flight);
    expect(Math.abs(peakY)).toBeCloseTo(apex, 0);
  });

  it('is monotonic in apex and safe at zero', () => {
    expect(launchSpeedForApex(GRAVITY, 400)).toBeLessThan(launchSpeedForApex(GRAVITY, 900));
    expect(launchSpeedForApex(GRAVITY, 0)).toBe(0);
    expect(launchSpeedForApex(GRAVITY, -50)).toBe(0);
  });
});

describe('solveLaunch — portrait field', () => {
  it('lands the item on its target x', () => {
    const startX = 100;
    const targetX = 600;
    const sol = solveLaunch({
      gravity: GRAVITY,
      fieldHeight: FIELD_H,
      startX,
      targetX,
      apexFrac: 0.66,
    });
    const end = simulate({ x: startX, y: 0, vx: sol.vx, vy: sol.vy }, GRAVITY, sol.flightSeconds);
    expect(end.x).toBeCloseTo(targetX, 0);
    // ...and returns to roughly its launch height.
    expect(Math.abs(end.y)).toBeLessThan(12);
  });

  it('produces an arcade-appropriate hang time in a portrait field', () => {
    // The regression this guards: the old hardcoded velocities were tuned for a
    // 720px-tall landscape field. Reused at 1280px they barely cleared a third
    // of the screen, so items were unreachable near the top of the field.
    for (const apexFrac of [0.58, 0.66, 0.74]) {
      const sol = solveLaunch({
        gravity: GRAVITY,
        fieldHeight: FIELD_H,
        startX: 360,
        targetX: 360,
        apexFrac,
      });
      expect(sol.flightSeconds).toBeGreaterThan(1.6);
      expect(sol.flightSeconds).toBeLessThan(2.3);
    }
  });

  it('rises a real fraction of the portrait field', () => {
    const sol = solveLaunch({
      gravity: GRAVITY,
      fieldHeight: FIELD_H,
      startX: 360,
      targetX: 360,
      apexFrac: 0.66,
    });
    expect(sol.apex / FIELD_H).toBeCloseTo(0.66, 5);
    expect(sol.vy).toBeLessThan(0); // upward in canvas coordinates
  });

  it('stays correct if the field size changes', () => {
    const tall = solveLaunch({
      gravity: GRAVITY,
      fieldHeight: 2000,
      startX: 0,
      targetX: 0,
      apexFrac: 0.6,
    });
    const short = solveLaunch({
      gravity: GRAVITY,
      fieldHeight: 600,
      startX: 0,
      targetX: 0,
      apexFrac: 0.6,
    });
    expect(tall.apex).toBeGreaterThan(short.apex);
    expect(tall.flightSeconds).toBeGreaterThan(short.flightSeconds);
  });
});

describe('horizontalVelocity', () => {
  it('is zero for a vertical toss', () => {
    expect(horizontalVelocity(300, 300, 2)).toBe(0);
  });

  it('is signed toward the target', () => {
    expect(horizontalVelocity(100, 500, 2)).toBeGreaterThan(0);
    expect(horizontalVelocity(500, 100, 2)).toBeLessThan(0);
  });

  it('does not divide by zero', () => {
    expect(horizontalVelocity(0, 100, 0)).toBe(0);
  });
});
