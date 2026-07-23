import { describe, expect, it } from 'vitest';
import {
  computeWeightTable,
  createWeightTable,
  legRegionWeight,
  armRegionWeight,
} from './weightTable';
import type { WeightTable, WeightTableInput } from './weightTable';

/** A neutral grounded-idle input; tests override the dimensions they exercise. */
function makeInput(overrides: Partial<WeightTableInput> = {}): WeightTableInput {
  return {
    standWeights: [1, 0, 0],
    crouchMoveWeight: 0,
    posture: 0,
    crawlBlend: 0,
    crawlMoveWeight: 0,
    tuckCrawl: 0,
    jumpBlend: 0,
    montageGate: 0,
    windup: 0,
    movementAngle: 0,
    crouchTint: 0,
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
    expect(sum(t, ['walkFwd', 'jogFwd', 'crouchIdle', 'crawlIdle', 'jumpBody', 'windupPose'])).toBeCloseTo(0, 6);
  });

  it('full walk forward puts the whole walk share on walkFwd', () => {
    const t = compute({ standWeights: [0, 1, 0] });
    expect(t.walkFwd).toBeCloseTo(1, 6);
    expect(t.walkBwd + t.walkLeft + t.walkRight).toBeCloseTo(0, 6);
  });

  it('crouched moving splits by crouchMoveWeight', () => {
    const t = compute({ posture: 1, crouchMoveWeight: 0.6 });
    expect(t.crouchIdle).toBeCloseTo(0.4, 6);
    expect(t.crouchFwd).toBeCloseTo(0.6, 6);
  });

  it('full crawl silences the stand/crouch sets and carries on the crawl set', () => {
    const t = compute({ crawlBlend: 1, crawlMoveWeight: 0.5 });
    expect(t.idle + t.crouchIdle + t.walkFwd).toBeCloseTo(0, 6);
    expect(t.crawlIdle).toBeCloseTo(0.5, 6);
    expect(t.crawlFwd).toBeCloseTo(0.5, 6);
  });

  it('airborne is the jump split, arms and body complementary by region', () => {
    const t = compute({ jumpBlend: 1 });
    expect(t.jumpBody).toBeCloseTo(1, 6);
    expect(t.jumpArms).toBeCloseTo(1, 6);
    expect(legRegionWeight(t)).toBeCloseTo(1, 6);
    expect(armRegionWeight(t)).toBeCloseTo(1, 6);
  });

  it('tucked pipe hang (airborne) hands the body to the crawl set', () => {
    const t = compute({ jumpBlend: 1, tuckCrawl: 1, crawlMoveWeight: 0 });
    expect(t.jumpBody).toBeCloseTo(0, 6); // notTuck fades the split out
    expect(t.crawlIdle).toBeCloseTo(1, 6); // baseWeight * tuckCrawl path
  });

  it('a full montage gate silences the entire base layer', () => {
    const t = compute({ montageGate: 1, standWeights: [0, 0, 1], jumpBlend: 0.5 });
    expect(legRegionWeight(t)).toBeCloseTo(0, 6);
    expect(armRegionWeight(t)).toBeCloseTo(0, 6);
  });

  it('windup hands the body to the preload pose', () => {
    const t = compute({ windup: 1 });
    expect(t.windupPose).toBeCloseTo(1, 6);
    expect(t.idle).toBeCloseTo(0, 6);
  });
});

describe('computeWeightTable — crouch tint and stance alpha', () => {
  it('exposes the stance alpha for the region-overlay layer', () => {
    expect(compute().stanceAlpha).toBeCloseTo(1, 6);
    expect(compute({ montageGate: 0.5 }).stanceAlpha).toBeCloseTo(0.5, 6);
    expect(compute({ jumpBlend: 1 }).stanceAlpha).toBeCloseTo(0, 6);
  });

  it('crouch tint shifts a fraction of the stand share onto the crouch clips', () => {
    const t = compute({ standWeights: [0, 1, 0], crouchTint: 0.2 });
    expect(t.walkFwd).toBeCloseTo(0.8, 6);
    expect(t.crouchFwd).toBeCloseTo(0, 6); // crouchMoveWeight 0 -> tint shows as crouch idle
    expect(t.crouchIdle).toBeCloseTo(0.2, 6);
    expect(legRegionWeight(t)).toBeCloseTo(1, 6); // pure reallocation, coverage unchanged
  });

  it('crouch tint routes through the crouch move split like real posture', () => {
    const t = compute({ standWeights: [0, 1, 0], crouchTint: 0.2, crouchMoveWeight: 1 });
    expect(t.walkFwd).toBeCloseTo(0.8, 6);
    expect(t.crouchFwd).toBeCloseTo(0.2, 6);
    expect(legRegionWeight(t)).toBeCloseTo(1, 6);
  });
});

describe('computeWeightTable — direction split', () => {
  it('movementAngle 0 keeps everything on Fwd', () => {
    const t = compute({ standWeights: [0, 1, 0], movementAngle: 0 });
    expect(t.walkFwd).toBeCloseTo(1, 6);
  });

  it('pure backward flips to Bwd', () => {
    const t = compute({ standWeights: [0, 1, 0], movementAngle: Math.PI });
    expect(t.walkBwd).toBeCloseTo(1, 6);
    expect(t.walkFwd).toBeCloseTo(0, 6);
  });

  it('diagonals split but preserve the gait total', () => {
    const t = compute({ standWeights: [0, 0, 1], movementAngle: Math.PI / 4 });
    expect(t.jogFwd).toBeCloseTo(0.5, 6);
    expect(t.jogLeft).toBeCloseTo(0.5, 6);
    expect(sum(t, ['jogFwd', 'jogBwd', 'jogLeft', 'jogRight'])).toBeCloseTo(1, 6);
  });
});

describe('computeWeightTable — coverage invariant (the anti-T-pose floor)', () => {
  // Exhaustive-ish grid over every input dimension. The invariant: for BOTH bone regions,
  // base coverage + montageGate never falls below ~1. Over-coverage is allowed (launch
  // transient, pipe tuck — PropertyMixer normalizes overweight; only UNDER-coverage bleeds
  // bind pose).
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const angles = [0, Math.PI / 3, Math.PI, -Math.PI / 2];

  it('holds across the input grid', () => {
    const out = createWeightTable();
    let checked = 0;
    for (const posture of steps) {
      for (const jumpBlend of steps) {
        for (const crawlBlend of steps) {
          for (const montageGate of steps) {
            for (const windup of [0, 0.5, 1]) {
              for (const tuckCrawl of [0, 0.5]) {
                for (const angle of angles) {
                  // standWeights sums to 1 like the damped real ones do (idle<->walk<->jog).
                  const w = posture; // reuse as a free knob for the stand split
                  const standWeights = [1 - w, w * 0.5, w * 0.5];
                  const input = makeInput({
                    standWeights,
                    crouchMoveWeight: jumpBlend, // free knob
                    posture,
                    crawlBlend,
                    crawlMoveWeight: windup, // free knob
                    tuckCrawl,
                    jumpBlend,
                    montageGate,
                    windup,
                    movementAngle: angle,
                  });
                  computeWeightTable(input, out);
                  const floor = 1 - 1e-6;
                  expect(legRegionWeight(out) + montageGate).toBeGreaterThanOrEqual(floor);
                  expect(armRegionWeight(out) + montageGate).toBeGreaterThanOrEqual(floor);
                  for (const key of Object.keys(out) as (keyof WeightTable)[]) {
                    expect(out[key]).toBeGreaterThanOrEqual(0);
                  }
                  checked++;
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('launch transient over-covers (windup unloading while jumpBlend rises) — documented', () => {
    const t = compute({ windup: 0.5, jumpBlend: 0.5 });
    expect(legRegionWeight(t)).toBeGreaterThan(1);
  });
});

describe('computeWeightTable — reuse contract', () => {
  it('writes every field on reuse (no stale values from a previous frame)', () => {
    const out = createWeightTable();
    computeWeightTable(makeInput({ standWeights: [0, 0, 1], jumpBlend: 0.7 }), out);
    computeWeightTable(makeInput(), out); // back to plain idle
    expect(out.idle).toBeCloseTo(1, 6);
    expect(out.jogFwd).toBeCloseTo(0, 6);
    expect(out.jumpBody).toBeCloseTo(0, 6);
  });
});
