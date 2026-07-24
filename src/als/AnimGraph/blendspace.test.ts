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
const SPEEDS: GaitSpeeds = { walk: 1, run: 3, sprint: 6 };
const CROUCH_WALK_SPEED = 1.5;
const STRIDES: GaitStrides = { walk: 1, run: 1.5, sprint: 2, crouchWalk: 0.75 };

describe('updateLocomotionTargets', () => {
  it('is fully idle at speed 0 and within the idle deadzone', () => {
    const t = [0, 0, 0, 0];
    expect(updateLocomotionTargets(0, t, SPEEDS, CROUCH_WALK_SPEED)).toBe(0);
    expect(t).toEqual([1, 0, 0, 0]);
    updateLocomotionTargets(IDLE_EPS, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([1, 0, 0, 0]);
  });

  it('crossfades idle→walk below the walk speed', () => {
    const t = [0, 0, 0, 0];
    updateLocomotionTargets(0.5, t, SPEEDS, CROUCH_WALK_SPEED); // half of walk speed 1
    expect(t[STAND.IDLE]).toBeCloseTo(0.5, 5);
    expect(t[STAND.WALK]).toBeCloseTo(0.5, 5);
    expect(t[STAND.RUN]).toBe(0);
    expect(t[STAND.SPRINT]).toBe(0);
    expect(sum(t)).toBeCloseTo(1, 5);
  });

  it('is pure walk exactly at the walk speed', () => {
    const t = [0, 0, 0, 0];
    updateLocomotionTargets(SPEEDS.walk, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([0, 1, 0, 0]);
  });

  it('crossfades walk→run in the walk/run band', () => {
    const t = [0, 0, 0, 0];
    updateLocomotionTargets(2, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t[STAND.WALK]).toBeCloseTo(0.5, 5);
    expect(t[STAND.RUN]).toBeCloseTo(0.5, 5);
    expect(t[STAND.IDLE]).toBe(0);
    expect(sum(t)).toBeCloseTo(1, 5);
  });

  it('is pure run at the run speed', () => {
    const t = [0, 0, 0, 0];
    updateLocomotionTargets(SPEEDS.run, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([0, 0, 1, 0]);
  });

  it('crossfades run→sprint and clamps above the sprint speed', () => {
    const t = [0, 0, 0, 0];
    updateLocomotionTargets(4.5, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t[STAND.RUN]).toBeCloseTo(0.5, 5);
    expect(t[STAND.SPRINT]).toBeCloseTo(0.5, 5);
    expect(sum(t)).toBeCloseTo(1, 5);
    updateLocomotionTargets(SPEEDS.sprint * 3, t, SPEEDS, CROUCH_WALK_SPEED);
    expect(t).toEqual([0, 0, 0, 1]);
  });

  it('ramps the crouch-move target linearly to 1 at the crouch-walk speed, then clamps', () => {
    expect(updateLocomotionTargets(CROUCH_WALK_SPEED / 2, [0, 0, 0, 0], SPEEDS, CROUCH_WALK_SPEED)).toBeCloseTo(0.5, 5);
    expect(updateLocomotionTargets(CROUCH_WALK_SPEED, [0, 0, 0, 0], SPEEDS, CROUCH_WALK_SPEED)).toBeCloseTo(1, 5);
    expect(updateLocomotionTargets(CROUCH_WALK_SPEED * 2, [0, 0, 0, 0], SPEEDS, CROUCH_WALK_SPEED)).toBe(1);
  });
});

describe('advanceLocomotionPhase', () => {
  const WALKING = [0, 1, 0, 0];

  it('freezes while within the idle deadzone', () => {
    expect(advanceLocomotionPhase(0.3, 1 / 60, IDLE_EPS, [1, 0, 0, 0], 0, 0, STRIDES)).toBe(0.3);
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

  it('uses PoseGait ramps to blend walk, run, and sprint strides', () => {
    // PoseGait 2.5 is halfway from run stride 1.5 to sprint stride 2.
    const phase = advanceLocomotionPhase(
      0,
      0.1,
      1.75,
      [0, 0, 0.5, 0.5],
      0,
      0,
      STRIDES,
      2.5,
    );
    expect(phase).toBeCloseTo(0.1, 6);
  });

  it('blends Standing and Crouching strides by crouchingAmount', () => {
    // standStride 1 and crouchStride 0.75 at crouchingAmount 0.5 yield 0.875.
    // speed 1, dt 1 => cadence 1/0.875 => %1
    const phase = advanceLocomotionPhase(0, 1, 1, WALKING, 1, 0.5, STRIDES);
    expect(phase).toBeCloseTo((1 / 0.875) % 1, 6);
  });

  it('wraps around 1', () => {
    // cadence 1 cycle/s, dt 1 => 0.9 + 1 = 1.9 -> %1 = 0.9
    expect(advanceLocomotionPhase(0.9, 1, 1, WALKING, 0, 0, STRIDES)).toBeCloseTo(0.9, 6);
  });
});
