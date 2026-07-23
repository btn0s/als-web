import { describe, expect, it } from 'vitest';
import {
  IDLE_EPS,
  STAND,
  advanceLocomotionPhase,
  updateLocomotionTargets,
  type GaitSpeeds,
  type GaitStrides,
} from './blendspace';

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

// Clean, decoupled test fixtures (the real values come from the model's baked root motion).
const SPEEDS: GaitSpeeds = { walk: 1, jog: 3 };
const CROUCH_WALK_SPEED = 1.5;
const STRIDES: GaitStrides = { walk: 1, jog: 1.5, crouchWalk: 0.75 };

describe('updateLocomotionTargets', () => {
  it('is fully idle at speed 0 and within the idle deadzone', () => {
    const t = [0, 0, 0];
    expect(updateLocomotionTargets(0, t, SPEEDS, CROUCH_WALK_SPEED)).toBe(0);
    expect(t).toEqual([1, 0, 0]);
    updateLocomotionTargets(IDLE_EPS, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([1, 0, 0]);
  });

  it('crossfades idle→walk below the walk speed', () => {
    const t = [0, 0, 0];
    updateLocomotionTargets(0.5, t, SPEEDS, CROUCH_WALK_SPEED); // half of walk speed 1
    expect(t[STAND.IDLE]).toBeCloseTo(0.5, 5);
    expect(t[STAND.WALK]).toBeCloseTo(0.5, 5);
    expect(t[STAND.JOG]).toBe(0);
    expect(sum(t)).toBeCloseTo(1, 5);
  });

  it('is pure walk exactly at the walk speed', () => {
    const t = [0, 0, 0];
    updateLocomotionTargets(SPEEDS.walk, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([0, 1, 0]);
  });

  it('crossfades walk→jog in the walk/jog band', () => {
    const t = [0, 0, 0];
    updateLocomotionTargets(2, t, SPEEDS, CROUCH_WALK_SPEED); // midway walk(1)→jog(3)
    expect(t[STAND.WALK]).toBeCloseTo(0.5, 5);
    expect(t[STAND.JOG]).toBeCloseTo(0.5, 5);
    expect(t[STAND.IDLE]).toBe(0);
    expect(sum(t)).toBeCloseTo(1, 5);
  });

  it('is pure jog at the jog speed and clamps above it (jog is the top gait)', () => {
    const t = [0, 0, 0];
    updateLocomotionTargets(SPEEDS.jog, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([0, 0, 1]);
    updateLocomotionTargets(SPEEDS.jog * 3, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([0, 0, 1]);
  });

  it('jogBlendMax caps the jog weight, keeping walk mixed in even at top speed', () => {
    const t = [0, 0, 0];
    updateLocomotionTargets(SPEEDS.jog, t, SPEEDS, CROUCH_WALK_SPEED, 0.7);
    expect(t[STAND.JOG]).toBeCloseTo(0.7, 5);
    expect(t[STAND.WALK]).toBeCloseTo(0.3, 5);
    expect(t[STAND.IDLE]).toBe(0);
    expect(sum(t)).toBeCloseTo(1, 5); // still normalized
    // midway through the band, jog is scaled by the cap too
    updateLocomotionTargets(2, t, SPEEDS, CROUCH_WALK_SPEED, 0.7); // t=0.5 -> jogW=0.35
    expect(t[STAND.JOG]).toBeCloseTo(0.35, 5);
    expect(t[STAND.WALK]).toBeCloseTo(0.65, 5);
  });

  it('ramps the crouch-move target linearly to 1 at the crouch-walk speed, then clamps', () => {
    expect(updateLocomotionTargets(CROUCH_WALK_SPEED / 2, [0, 0, 0], SPEEDS, CROUCH_WALK_SPEED)).toBeCloseTo(0.5, 5);
    expect(updateLocomotionTargets(CROUCH_WALK_SPEED, [0, 0, 0], SPEEDS, CROUCH_WALK_SPEED)).toBeCloseTo(1, 5);
    expect(updateLocomotionTargets(CROUCH_WALK_SPEED * 2, [0, 0, 0], SPEEDS, CROUCH_WALK_SPEED)).toBe(1);
  });
});

describe('advanceLocomotionPhase', () => {
  const WALKING = [0, 1, 0];

  it('freezes while within the idle deadzone', () => {
    expect(advanceLocomotionPhase(0.3, 1 / 60, IDLE_EPS, [1, 0, 0], 0, 0, STRIDES)).toBe(0.3);
  });

  it('advances at cadence = speed / stride (foot-locked)', () => {
    // walkStride 1, speed 2, dt 0.1 => cadence 2 cycles/s => +0.2 phase
    expect(advanceLocomotionPhase(0, 0.1, 2, WALKING, 0, 0, STRIDES)).toBeCloseTo(0.2, 6);
  });

  it('scales phase advance linearly with ground speed (no foot slide at any speed)', () => {
    const slow = advanceLocomotionPhase(0, 0.1, 2, WALKING, 0, 0, STRIDES);
    const fast = advanceLocomotionPhase(0, 0.1, 4, WALKING, 0, 0, STRIDES);
    expect(fast).toBeCloseTo(2 * slow, 6); // double the speed => double the cadence
  });

  it('blends stand and crouch stride by posture', () => {
    // standStride = 1 (walk), crouchStride = 0.75 (crouchWalk), posture 0.5 => effStride 0.875
    // speed 1, dt 1 => cadence 1/0.875 => %1
    const phase = advanceLocomotionPhase(0, 1, 1, WALKING, 1, 0.5, STRIDES);
    expect(phase).toBeCloseTo((1 / 0.875) % 1, 6);
  });

  it('uses the measured crawl stride when crawl is fully blended in', () => {
    // Crawl owns cadence completely: stride 0.5, speed 1, dt 0.1 => +0.2 phase.
    const phase = advanceLocomotionPhase(0, 0.1, 1, WALKING, 1, 1, STRIDES, 0.5, 1, 1);
    expect(phase).toBeCloseTo(0.2, 6);
  });

  it('blends the upright and crawl strides during the stance transition', () => {
    // Upright crouch stride = 0.75; moving crawl stride = 0.25; half crawl => 0.5 effective.
    const phase = advanceLocomotionPhase(0, 0.1, 1, WALKING, 1, 1, STRIDES, 0.25, 1, 0.5);
    expect(phase).toBeCloseTo(0.2, 6);
  });

  it('keeps a crawl-idle phase frozen inside the ground-speed deadzone', () => {
    expect(
      advanceLocomotionPhase(0.37, 1, IDLE_EPS, WALKING, 1, 1, STRIDES, 0.5, 0, 1),
    ).toBe(0.37);
  });

  it('does not advance when the active crawl clip has a degenerate zero stride', () => {
    expect(
      advanceLocomotionPhase(0.37, 1, 0.5, WALKING, 1, 1, STRIDES, 0, 1, 1),
    ).toBe(0.37);
  });

  it('wraps around 1', () => {
    // cadence 1 cycle/s, dt 1 => 0.9 + 1 = 1.9 -> %1 = 0.9
    expect(advanceLocomotionPhase(0.9, 1, 1, WALKING, 0, 0, STRIDES)).toBeCloseTo(0.9, 6);
  });
});
