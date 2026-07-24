import { describe, expect, it } from 'vitest';
import {
  computeWeightTable,
  createWeightTable,
  mapVelocityBlendToSixDirections,
  legRegionWeight,
  armRegionWeight,
} from './weightTable';
import type { WeightTable, WeightTableInput } from './weightTable';

/** A neutral grounded-idle input; tests override the dimensions they exercise. */
function makeInput(overrides: Partial<WeightTableInput> = {}): WeightTableInput {
  return {
    standWeights: [1, 0, 0, 0],
    crouchMoveWeight: 0,
    crouchingAmount: 0,
    inAirAmount: 0,
    montageGate: 0,
    velocityBlend: {
      forwardAmount: 1,
      backwardAmount: 0,
      leftAmount: 0,
      rightAmount: 0,
    },
    ...overrides,
  };
}

function compute(overrides: Partial<WeightTableInput> = {}): WeightTable {
  return computeWeightTable(makeInput(overrides), createWeightTable());
}

const sum = (t: WeightTable, keys: (keyof WeightTable)[]) =>
  keys.reduce((acc, k) => acc + t[k], 0);

describe('computeWeightTable — steady states', () => {
  it('grounded standing idle is pure idle', () => {
    const t = compute();
    expect(t.idle).toBeCloseTo(1, 6);
    expect(legRegionWeight(t)).toBeCloseTo(1, 6);
    expect(sum(t, ['walkFwd', 'runFwd', 'sprint', 'crouchIdle', 'jumpBody']))
      .toBeCloseTo(0, 6);
  });

  it('full walk forward puts the whole walk share on walkFwd', () => {
    const t = compute({ standWeights: [0, 1, 0, 0] });
    expect(t.walkFwd).toBeCloseTo(1, 6);
    expect(
      t.walkBwd + t.walkLeftFwd + t.walkRightFwd + t.walkLeftBwd + t.walkRightBwd,
    ).toBeCloseTo(0, 6);
  });

  it('crouched moving splits by crouchMoveWeight', () => {
    const t = compute({ crouchingAmount: 1, crouchMoveWeight: 0.6 });
    expect(t.crouchIdle).toBeCloseTo(0.4, 6);
    expect(t.crouchFwd).toBeCloseTo(0.6, 6);
  });

  it('airborne is the jump split, arms and body complementary by region', () => {
    const t = compute({ inAirAmount: 1 });
    expect(t.jumpBody).toBeCloseTo(1, 6);
    expect(t.jumpArms).toBeCloseTo(1, 6);
    expect(legRegionWeight(t)).toBeCloseTo(1, 6);
    expect(armRegionWeight(t)).toBeCloseTo(1, 6);
  });

  it('a full montage gate silences the entire base layer', () => {
    const t = compute({ montageGate: 1, standWeights: [0, 0, 0, 1], inAirAmount: 0.5 });
    expect(legRegionWeight(t)).toBeCloseTo(0, 6);
    expect(armRegionWeight(t)).toBeCloseTo(0, 6);
  });
});

describe('computeWeightTable — grounded amount', () => {
  it('exposes the grounded amount for the region-overlay layer', () => {
    expect(compute().groundedAmount).toBeCloseTo(1, 6);
    expect(compute({ montageGate: 0.5 }).groundedAmount).toBeCloseTo(0.5, 6);
    expect(compute({ inAirAmount: 1 }).groundedAmount).toBeCloseTo(0, 6);
  });
});

describe('computeWeightTable — direction split', () => {
  it('a forward velocity blend keeps everything on Fwd', () => {
    const t = compute({ standWeights: [0, 1, 0, 0] });
    expect(t.walkFwd).toBeCloseTo(1, 6);
  });

  it('pure backward flips to Bwd', () => {
    const t = compute({
      standWeights: [0, 1, 0, 0],
      velocityBlend: {
        forwardAmount: 0,
        backwardAmount: 1,
        leftAmount: 0,
        rightAmount: 0,
      },
    });
    expect(t.walkBwd).toBeCloseTo(1, 6);
    expect(t.walkFwd).toBeCloseTo(0, 6);
  });

  it('an L1 diagonal selects the authored diagonal clip rather than blending cardinals', () => {
    const t = compute({
      standWeights: [0, 0, 1, 0],
      velocityBlend: {
        forwardAmount: 0.5,
        backwardAmount: 0,
        leftAmount: 0.5,
        rightAmount: 0,
      },
    });
    expect(t.runLeftFwd).toBeCloseTo(1, 6);
    expect(sum(t, [
      'runFwd', 'runBwd', 'runLeftFwd', 'runRightFwd', 'runLeftBwd', 'runRightBwd',
    ])).toBeCloseTo(1, 6);
  });

  it('pure lateral movement shares the adjacent authored diagonal pair', () => {
    const directions = mapVelocityBlendToSixDirections({
      forwardAmount: 0,
      backwardAmount: 0,
      leftAmount: 1,
      rightAmount: 0,
    });
    expect(directions.leftForward).toBeCloseTo(0.5, 6);
    expect(directions.leftBackward).toBeCloseTo(0.5, 6);
    expect(Object.values(directions).reduce((total, value) => total + value, 0)).toBeCloseTo(1, 6);
  });

  it('preserves damped opposite longitudinal channels during direction changes', () => {
    const directions = mapVelocityBlendToSixDirections({
      forwardAmount: 0.25,
      backwardAmount: 0.75,
      leftAmount: 0,
      rightAmount: 0,
    });
    expect(directions.forward).toBeCloseTo(0.25, 6);
    expect(directions.backward).toBeCloseTo(0.75, 6);
  });

  it('keeps sprint as the single authored forward gait clip', () => {
    const t = compute({
      standWeights: [0, 0, 0, 1],
      velocityBlend: {
        forwardAmount: 0,
        backwardAmount: 0,
        leftAmount: 0,
        rightAmount: 1,
      },
    });
    expect(t.sprint).toBeCloseTo(1, 6);
  });
});

describe('computeWeightTable — coverage invariant (the anti-T-pose floor)', () => {
  // Exhaustive-ish grid over every input dimension. The invariant: for BOTH bone regions,
  // base coverage + montageGate stays at 1.
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const directions = [
    { forwardAmount: 1, backwardAmount: 0, leftAmount: 0, rightAmount: 0 },
    { forwardAmount: 0.5, backwardAmount: 0, leftAmount: 0.5, rightAmount: 0 },
    { forwardAmount: 0, backwardAmount: 1, leftAmount: 0, rightAmount: 0 },
    { forwardAmount: 0, backwardAmount: 0, leftAmount: 0, rightAmount: 1 },
  ];

  it('holds across the input grid', () => {
    const out = createWeightTable();
    let checked = 0;
    for (const crouchingAmount of steps) {
      for (const inAirAmount of steps) {
        for (const montageGate of steps) {
          for (const velocityBlend of directions) {
            // standWeights sums to 1 like the damped real ones do.
            const w = crouchingAmount; // reuse as a free knob for the standing gait split
            const standWeights = [1 - w, w / 3, w / 3, w / 3];
            const input = makeInput({
              standWeights,
              crouchMoveWeight: inAirAmount, // free knob
              crouchingAmount,
              inAirAmount,
              montageGate,
              velocityBlend,
            });
            computeWeightTable(input, out);
            expect(legRegionWeight(out) + montageGate).toBeCloseTo(1, 6);
            expect(armRegionWeight(out) + montageGate).toBeCloseTo(1, 6);
            for (const key of Object.keys(out) as (keyof WeightTable)[]) {
              expect(out[key]).toBeGreaterThanOrEqual(0);
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(500);
  });
});

describe('computeWeightTable — reuse contract', () => {
  it('writes every field on reuse (no stale values from a previous frame)', () => {
    const out = createWeightTable();
    computeWeightTable(makeInput({ standWeights: [0, 0, 0, 1], inAirAmount: 0.7 }), out);
    computeWeightTable(makeInput(), out); // back to plain idle
    expect(out.idle).toBeCloseTo(1, 6);
    expect(out.sprint).toBeCloseTo(0, 6);
    expect(out.jumpBody).toBeCloseTo(0, 6);
  });
});
